import { app, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFormBundle } from '@fib/core';
import type { ApiClient } from '@fib/api-client';
import { findPhrase } from '@fib/ingest';
import { parseArgs } from './args.js';
import { pickFreePort, buildCdpUrl, waitForCdpVersion } from './cdp.js';
import { createHostWindow } from './windows.js';
import { registerIpcHandlers } from './ipc.js';
import { createApiClient, SessionController } from './SessionController.js';
import { ingestFiles } from './ingestService.js';
import { resolveConfigsDir } from './paths.js';

// Re-exported so tests can dynamically `import()` this already-loaded module
// (via Playwright's `electronApp.evaluate`) and exercise the real classes.
export { ElectronHtmlToPdf } from './htmlToPdf.js';
export { ingestFiles } from './ingestService.js';
export type { IngestFilesResult, IngestProgress } from './ingestService.js';
export { SessionController, createApiClient } from './SessionController.js';
export type { SessionControllerDeps } from './SessionController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cdpUrl: string | null = null;
let apiClient: ApiClient | null = null;

/** The desktop's own remote-debugging endpoint, set once `main()` has picked a port. */
export function getCdpUrl(): string | null {
  return cdpUrl;
}

/** The extract/run-log client this session uses (exposed for tests). */
export function getApiClient(): ApiClient | null {
  return apiClient;
}

function configsDir(): string {
  return resolveConfigsDir(app.isPackaged, process.resourcesPath, __dirname);
}

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.mjs');
}

async function main(): Promise<void> {
  // CI runners have no display server; render headless instead of needing Xvfb
  // (same approach as packages/driver-playwright's CDP test launcher). Must be
  // set before the first `app.whenReady()`, regardless of which branch below runs.
  if (process.env.CI) {
    app.commandLine.appendSwitch('headless', 'new');
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
    app.commandLine.appendSwitch('disable-gpu');
  }

  const rawArgs = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
  const hostArgs = parseArgs(rawArgs);

  if (hostArgs === null) {
    await app.whenReady();
    const usage = 'Usage: fib --dealId=<id> --formId=<id> (or fib.exe <dealId> <formId>)';
    if (process.env.CI) {
      console.error(usage);
    } else {
      dialog.showErrorBox('Fill-It-Bro', usage);
    }
    app.exit(2);
    return;
  }

  const port = await pickFreePort();
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  cdpUrl = buildCdpUrl(port);

  await app.whenReady();
  // e2e tests parse this line to discover the CDP port; keep the prefix stable.
  console.log(`[fib] cdp-url ${cdpUrl}`);

  // Ticket 28 `--smoke`: CI starts the packaged exe and expects a 0 exit once the
  // app's own DevTools endpoint answers; no windows are opened in this mode.
  if (hostArgs.smoke) {
    const timeoutMs = Number(process.env.FIB_SMOKE_TIMEOUT_MS ?? '15000');
    try {
      await waitForCdpVersion(cdpUrl, timeoutMs);
    } catch (err) {
      console.error(`[fib] smoke failed: ${String(err)}`);
      app.exit(1);
      return;
    }
    console.log(`[fib] smoke ok ${cdpUrl}`);
    app.exit(0);
    return;
  }

  const bundle = loadFormBundle(configsDir(), hostArgs.formId);
  const formUrl = bundle.urlTemplate.replace('{dealId}', hostArgs.dealId);

  // Ticket 25: `FIB_API=fake` -> FakeApiClient (used by e2e), else HTTP service.
  apiClient = createApiClient();

  const { formView, panelView } = createHostWindow(preloadPath());

  const controller = new SessionController({
    dealId: hostArgs.dealId,
    bundle,
    formView,
    panelView,
    getCdpUrl,
    api: apiClient,
    ingestFiles,
    findPhrase,
  });

  registerIpcHandlers(controller);

  // The controller listens for `did-finish-load`; start the form load last.
  await formView.webContents.loadURL(formUrl);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await panelView.webContents.loadURL(rendererUrl);
  } else {
    await panelView.webContents.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  // The panel subscribed after formReady was pushed; replay so it isn't stuck idle.
  controller.replaySnapshot();
}

main().catch((err: unknown) => {
  console.error(err);
  app.exit(1);
});
