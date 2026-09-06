import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ticket 29: the whole loop in one spec — ticket 25's fill flow, ticket 26's
// inline edit + re-push, and the citation viewer opening on the cited page.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const mainPath = join(repoRoot, 'apps/desktop/dist/main/index.js');
const sampleMsg = join(repoRoot, 'packages/ingest/fixtures/sample.msg');
const fakeFixturesDir = join(repoRoot, 'apps/desktop/e2e/fixtures');
const expectedModel = JSON.parse(
  readFileSync(join(repoRoot, 'apps/desktop/e2e/expected/fixtureDeal-edit.json'), 'utf-8'),
) as unknown;

/** Minimal shape of the preload bridge used by this spec. */
interface FibBridge {
  onSessionSnapshot(listener: (snapshot: { state: string }) => void): () => void;
  filesDropped(payload: { paths: string[] }): Promise<void>;
}

/** Resolves with the session state once the panel observes the target state. */
function nextSessionState(panelPage: Page, state: string): Promise<string> {
  return panelPage.evaluate((target) => {
    const fib = (window as unknown as { fib?: FibBridge }).fib;
    if (!fib) throw new Error('window.fib is not available');
    return new Promise<string>((resolveState) => {
      fib.onSessionSnapshot((snapshot) => {
        if (snapshot.state === target) resolveState(snapshot.state);
      });
    });
  }, state);
}

/** Clicks the field's value, types the new value and commits with Enter. */
async function editField(panelPage: Page, fieldId: string, value: string): Promise<void> {
  const row = panelPage.locator(`[data-testid="field-${fieldId}"]`);
  await row.locator('.field-row__value').click();
  const editor = row.locator(`[data-testid="edit-${fieldId}"]`);
  await editor.fill(value);
  await editor.press('Enter');
}

test.describe('full loop', () => {
  // The .msg ingest OCRs the PNG attachment; give the whole loop room to breathe.
  test.setTimeout(300_000);

  let app: ElectronApplication;
  let userDataDir: string;
  let formPage: Page;
  let panelPage: Page;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'fib-e2e-full-loop-'));
    app = await electron.launch({
      args: [mainPath, '--dealId=1', '--formId=fixtureDeal', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        FIB_API: 'fake',
        FIB_FAKE_FIXTURES_DIR: fakeFixturesDir,
      },
    });

    const fixturePort = process.env.FIXTURE_PORT ?? '4300';
    const deadline = Date.now() + 30_000;
    for (;;) {
      const pages = app.windows();
      const form = pages.find((p) => p.url().includes(`localhost:${fixturePort}/deal/1`));
      if (form && pages.length >= 2) {
        formPage = form;
        panelPage = pages.find((p) => p !== form)!;
        break;
      }
      if (Date.now() > deadline) throw new Error('form/panel windows never appeared');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(formPage, 'form view page never appeared').toBeTruthy();
    await panelPage.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  async function modelJson(): Promise<Record<string, unknown>> {
    const text = await formPage.textContent('#model');
    return JSON.parse(text ?? '{}') as Record<string, unknown>;
  }

  test('fills the form from sample.msg, re-pushes an edit and shows the citation', async () => {
    // --- ticket 25 flow: drop the .msg and ride to review --------------------
    const reviewReached = nextSessionState(panelPage, 'review');
    await panelPage.evaluate(
      async (paths) => {
        const fib = (window as unknown as { fib?: FibBridge }).fib;
        if (!fib) throw new Error('window.fib is not available');
        await fib.filesDropped({ paths });
      },
      [sampleMsg],
    );
    expect(await reviewReached, 'session ended in a failure state').toBe('review');
    expect(await modelJson()).toEqual(expectedModel);

    // Panel badges: verified for the filled scalar field and the parties cells.
    const dealAmount = panelPage.locator('[data-testid="field-dealAmount"]');
    await expect(dealAmount.locator('[data-status="verified"]')).toBeVisible();
    const partiesGroup = panelPage.locator('[data-testid="group-parties"]');
    await partiesGroup.locator('summary').click();
    await expect(
      partiesGroup.locator(
        '[data-testid="field-parties\\[0\\]\\.partyName"] [data-status="verified"]',
      ),
    ).toBeVisible();

    // Run log reached the fake client: one startRun and at least one logEvent.
    const calls = await app.evaluate((electronApp, entryPath: string) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mod = createRequire(entryPath)(entryPath) as {
        getApiClient(): { calls: { method: string }[] } | null;
      };
      return (mod.getApiClient()?.calls ?? []).map((call) => call.method);
    }, mainPath);
    expect(calls.filter((method) => method === 'startRun')).toHaveLength(1);
    expect(calls.filter((method) => method === 'logEvent').length).toBeGreaterThanOrEqual(1);

    // The executor never touched Submit.
    const submitted = await formPage.evaluate(
      () => (window as unknown as { __submitted?: boolean }).__submitted,
    );
    expect(submitted).toBeUndefined();

    // --- ticket 26: inline edit + re-push ------------------------------------
    const reviewAfterEdit = nextSessionState(panelPage, 'review');
    await editField(panelPage, 'dealAmount', '2000000');
    await reviewAfterEdit;
    await expect(dealAmount.locator('[data-status="verified"]')).toBeVisible();
    expect(await modelJson()).toMatchObject({ dealAmount: '2000000' });

    // --- ticket 29: open the citation viewer ---------------------------------
    // The fake extract fixture cites itemIds p1i2/p1i3, i.e. mergedPage 1 of the
    // 4-page merged PDF (email body, 2-page attachment, PNG attachment).
    await panelPage.locator('[data-testid="source-dealAmount"]').click();
    const viewer = panelPage.locator('[data-testid="viewer-pane"]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-testid="page-indicator"]')).toHaveText('1 / 4');

    // A highlight box sits over the cited text on that page.
    const highlight = viewer.locator('[data-testid="hl"]').first();
    await expect(highlight).toBeVisible();
    const box = await highlight.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // Back to the field list.
    await viewer.locator('[data-testid="viewer-close"]').click();
    await expect(dealAmount).toBeVisible();
  });
});
