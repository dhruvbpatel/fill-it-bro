import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');
const sampleMsg = resolve(__dirname, '../../../packages/ingest/fixtures/sample.msg');
const fakeFixturesDir = resolve(__dirname, '../e2e/fixtures');
const expectedModel = JSON.parse(
  readFileSync(resolve(__dirname, '../e2e/expected/fixtureDeal-edit.json'), 'utf-8'),
) as unknown;

/** Minimal shape of the preload bridge used by this spec. */
interface FibBridge {
  onSessionSnapshot(listener: (snapshot: { state: string }) => void): () => void;
  filesDropped(payload: { paths: string[] }): Promise<void>;
}

/** Resolves with the session state once the panel observes the target state again. */
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

test.describe('desktop edit + re-push', () => {
  // The initial fill includes the .msg OCR; give it the same room as session.spec.ts.
  test.setTimeout(300_000);
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let userDataDir: string;
  let formPage: Page;
  let panelPage: Page;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'fib-desktop-edit-'));
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

  test('fills the form, edits dealAmount and re-pushes it verified', async () => {
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

    // Inline edit: click the value, type, Enter -> single-step re-push.
    const reviewAfterEdit = nextSessionState(panelPage, 'review');
    await editField(panelPage, 'dealAmount', '2000000');
    await reviewAfterEdit;

    const dealAmount = panelPage.locator('[data-testid="field-dealAmount"]');
    await expect(dealAmount.locator('[data-status="verified"]')).toBeVisible();
    expect(await modelJson()).toMatchObject({ dealAmount: '2000000' });
  });

  test('edits a parties grid cell and updates only that cell', async () => {
    const group = panelPage.locator('[data-testid="group-parties"]');
    await group.locator('summary').click();

    const reviewAfterEdit = nextSessionState(panelPage, 'review');
    await editField(panelPage, 'parties[0].amount', '5550000');
    await reviewAfterEdit;

    // The list remounts after the re-push (state filling swaps in the progress
    // bar), collapsing the <details>; re-open and retry around the remount race.
    const cellRow = group.locator('[data-testid="field-parties\\[0\\]\\.amount"]');
    await expect(async () => {
      await group.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await expect(cellRow.locator('[data-status="verified"]')).toBeVisible();
    }).toPass();

    // Only the edited cell moved; everything else keeps its re-pushed value.
    expect(await modelJson()).toEqual({
      ...expectedModel,
      dealAmount: '2000000',
      parties: [{ partyName: 'Goldman Sachs Incorporated', role: 'Issuer', amount: '5550000' }],
    });
  });

  test('escape leaves the value unchanged and dispatches nothing', async () => {
    const callsBefore = await apiCallCount();
    const row = panelPage.locator('[data-testid="field-dealAmount"]');
    await row.locator('.field-row__value').click();
    const editor = row.locator('[data-testid="edit-dealAmount"]');
    await editor.fill('999');
    await editor.press('Escape');

    await expect(editor).toHaveCount(0);
    await expect(row.locator('.field-row__value')).toHaveText('2000000');
    expect(await modelJson()).toMatchObject({ dealAmount: '2000000' });
    expect(await apiCallCount()).toBe(callsBefore);
  });

  async function apiCallCount(): Promise<number> {
    return app.evaluate((electronApp, entryPath: string) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mod = createRequire(entryPath)(entryPath) as {
        getApiClient(): { calls: unknown[] } | null;
      };
      return (mod.getApiClient()?.calls ?? []).length;
    }, mainPath);
  }
});
