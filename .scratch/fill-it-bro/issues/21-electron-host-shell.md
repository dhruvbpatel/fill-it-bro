# 21: Electron host shell

**What to build:** The desktop app launches with a deal id, opens the deal's form URL in its own browser view, shows the React panel beside it, exposes a loopback CDP endpoint for the driver, and gives the renderer a typed bridge API. No session logic yet.

**Blocked by:** 10 (Core: config loader + validate-configs), 02 (Contracts + codegen)

**Status:** done

## Read first
- PLAN.md §2 diagram, §8 BrowserDriver paragraph, §9 IPC, §12 CDP.

## Do exactly this
- `apps/desktop` with electron-vite: `src/main/index.ts`, `src/preload/index.ts`, renderer = `@fib/panel` build.
- Args: `--dealId=<id> --formId=<id>` (also accept positional for the deploy pipeline: `fib.exe <dealId> <formId>`). Missing → dialog + exit 2.
- Before `app.whenReady()`: pick a free port with `net.createServer().listen(0)`, then `app.commandLine.appendSwitch('remote-debugging-port', String(port))` and `('remote-debugging-address', '127.0.0.1')`. Expose `getCdpUrl()` = `http://127.0.0.1:<port>`.
- Window: `BaseWindow` 1600×1000; left `WebContentsView` (form) 1150 px, right `WebContentsView` (panel) 450 px; resize handler keeps the split. Form view loads `urlTemplate.replace('{dealId}', dealId)` from `loadFormBundle(configsDir, formId)` where `configsDir` = `process.resourcesPath/configs` in packaged builds and `<repo>/configs` in dev.
- Preload: `contextBridge.exposeInMainWorld('fib', api)` where `api` is generated from `packages/contracts/src/ipc-channels.ts` (add it: `const channels = { 'session:snapshot', 'session:event', 'files:dropped', 'field:edit', 'viewer:open' } as const` with typed payloads). Renderer→main via `ipcRenderer.invoke`, main→renderer via `webContents.send`.
- `ElectronHtmlToPdf implements HtmlToPdf` (from `@fib/ingest`): hidden `BrowserWindow`, `loadURL('data:text/html;base64,…')`, `printToPDF({ printBackground: true })`, close.
- Dev script: `pnpm --filter desktop dev -- --dealId=1 --formId=fixtureDeal` (fixture must be running).

## Acceptance criteria
- [ ] Dev launch opens the fixture at `/deal/1` on the left and the panel placeholder on the right.
- [ ] `curl http://127.0.0.1:<port>/json/version` returns Chromium info; port is not reachable on non-loopback interfaces.
- [ ] `ElectronHtmlToPdf.render('<h1>Hi</h1>')` returns a PDF whose text contains "Hi" (test with `pdf-parse` or LiteParse).
- [ ] Missing args exit code 2.
