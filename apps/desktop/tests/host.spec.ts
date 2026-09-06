import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import pdfParse from 'pdf-parse';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');
const fixturePort = process.env.FIXTURE_PORT ?? '4300';

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort: chromium children may still be writing
  }
}

test.describe('desktop host shell', () => {
  let app: ElectronApplication;
  let userDataDir: string;
  let cdpUrl: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'fib-desktop-'));
    app = await electron.launch({
      args: [mainPath, '--dealId=1', '--formId=fixtureDeal', `--user-data-dir=${userDataDir}`],
    });

    const deadline = Date.now() + 15_000;
    let discoveredCdpUrl: string | null = null;
    while (discoveredCdpUrl === null) {
      if (Date.now() > deadline) throw new Error('timed out waiting for cdp-url log line');
      discoveredCdpUrl = await app.evaluate((_electron, entryPath: string) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const main = createRequire(entryPath)(entryPath) as { getCdpUrl(): string | null };
        return main.getCdpUrl();
      }, mainPath);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    cdpUrl = discoveredCdpUrl;
  });

  test.afterAll(async () => {
    await app.close();
    cleanupDir(userDataDir);
  });

  test('opens the fixture form on the left and the panel on the right', async () => {
    let pages: Page[] = [];
    const deadline = Date.now() + 15_000;
    while (pages.length < 2 && Date.now() < deadline) {
      pages = app.windows();
      if (pages.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pages.length).toBeGreaterThanOrEqual(2);

    const formPage = pages.find((p) => p.url().includes(`localhost:${fixturePort}/deal/1`));
    expect(formPage, `no form page among: ${pages.map((p) => p.url()).join(', ')}`).toBeTruthy();

    const panelPage = pages.find((p) => p !== formPage);
    expect(panelPage).toBeTruthy();
    await panelPage!.waitForLoadState('domcontentloaded');
    const panelText = await panelPage!.textContent('body');
    expect(panelText).toContain('Fill-It-Bro panel');
  });

  test('exposes a loopback-only CDP endpoint', async () => {
    expect(cdpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const res = await fetch(`${cdpUrl}/json/version`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.Browser).toBeTruthy();

    const cdpPort = Number(cdpUrl.split(':').pop());
    const nonLoopback = Object.values(os.networkInterfaces())
      .flat()
      .find((info) => info && !info.internal && info.family === 'IPv4');
    if (!nonLoopback) {
      test.skip(true, 'no non-loopback interface available in this sandbox to test against');
      return;
    }
    await expect(
      fetch(`http://${nonLoopback.address}:${cdpPort}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toBeTruthy();
  });

  test('ElectronHtmlToPdf renders HTML to a PDF', async () => {
    const base64 = await app.evaluate(async (_electron, entryPath: string) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mod = createRequire(entryPath)(entryPath) as {
        ElectronHtmlToPdf: new () => { render(html: string): Promise<Buffer> };
      };
      const pdf = await new mod.ElectronHtmlToPdf().render('<h1>Hi</h1>');
      return pdf.toString('base64');
    }, mainPath);

    const buffer = Buffer.from(base64, 'base64');
    const parsed = await pdfParse(buffer);
    expect(parsed.text).toContain('Hi');
  });
});
