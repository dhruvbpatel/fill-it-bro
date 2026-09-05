import { app, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFormBundle } from '@fib/core';
import { parseArgs } from './args.js';
import { pickFreePort, buildCdpUrl } from './cdp.js';
import { createHostWindow } from './windows.js';
import { registerIpcHandlers } from './ipc.js';
import { resolveConfigsDir } from './paths.js';

// Re-exported so tests can dynamically `import()` this already-loaded module
// (via Playwright's `electronApp.evaluate`) and exercise the real class.
export { ElectronHtmlToPdf } from './htmlToPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cdpUrl: string | null = null;

/** The desktop's own remote-debugging endpoint, set once `main()` has picked a port. */
export function getCdpUrl(): string | null {
  return cdpUrl;
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

  const bundle = loadFormBundle(configsDir(), hostArgs.formId);
  const formUrl = bundle.urlTemplate.replace('{dealId}', hostArgs.dealId);

  registerIpcHandlers();

  const { formView, panelView } = createHostWindow(preloadPath());
  await formView.webContents.loadURL(formUrl);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await panelView.webContents.loadURL(rendererUrl);
  } else {
    await panelView.webContents.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  app.exit(1);
});
