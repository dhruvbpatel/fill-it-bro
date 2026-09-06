import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');
const sampleMsg = resolve(__dirname, '../../../packages/ingest/fixtures/sample.msg');
const expectedModel = JSON.parse(
  readFileSync(resolve(__dirname, '../e2e/expected/fixtureDeal.json'), 'utf-8'),
) as unknown;

/** Minimal shape of the preload bridge used by this spec. */
interface FibBridge {
  onSessionSnapshot(listener: (snapshot: { state: string }) => void): () => void;
  filesDropped(payload: { paths: string[] }): Promise<void>;
}

test.describe('desktop session wiring', () => {
  // The .msg ingest OCRs the PNG attachment; give the whole loop room to breathe.
  test.setTimeout(300_000);

  let app: ElectronApplication;
  let userDataDir: string;
  let formPage: Page;
  let panelPage: Page;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'fib-desktop-session-'));
    app = await electron.launch({
      args: [mainPath, '--dealId=1', '--formId=fixtureDeal', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, FIB_API: 'fake' },
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

  test('fills the fixture form from sample.msg and reaches review', async () => {
    // Resolve with the terminal session state once the panel observes it.
    await panelPage.evaluate(() => {
      const fib = (window as unknown as { fib?: FibBridge }).fib;
      if (!fib) throw new Error('window.fib is not available');
      (window as unknown as { __sessionDone: Promise<string> }).__sessionDone = new Promise<string>(
        (resolveState) => {
          fib.onSessionSnapshot((snapshot) => {
            if (snapshot.state === 'review' || snapshot.state === 'failed') {
              resolveState(snapshot.state);
            }
          });
        },
      );
    });

    // Drop sample.msg through the files:dropped IPC channel.
    await panelPage.evaluate(
      async (paths) => {
        const fib = (window as unknown as { fib?: FibBridge }).fib;
        if (!fib) throw new Error('window.fib is not available');
        await fib.filesDropped({ paths });
      },
      [sampleMsg],
    );

    const finalState = await panelPage.evaluate(
      () => (window as unknown as { __sessionDone: Promise<string> }).__sessionDone,
    );
    expect(finalState, 'session ended in a failure state').toBe('review');

    // The form's model equals the expectation authored from the fake extract fixture.
    const modelText = await formPage.textContent('#model');
    expect(JSON.parse(modelText ?? '{}')).toEqual(expectedModel);

    // Panel badges: verified for every filled scalar field and the parties group.
    await expect(
      panelPage.locator('[data-testid="field-issuerName"] [data-status="verified"]'),
    ).toBeVisible();
    const partiesGroup = panelPage.locator('[data-testid="group-parties"]');
    await partiesGroup.locator('summary').click(); // expand the collapsible group
    await expect(
      partiesGroup.locator(
        '[data-testid="field-parties\\[0\\]\\.partyName"] [data-status="verified"]',
      ),
    ).toBeVisible();
    await expect(
      partiesGroup.locator('[data-testid="field-parties\\[0\\]\\.role"] [data-status="verified"]'),
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
  });
});
