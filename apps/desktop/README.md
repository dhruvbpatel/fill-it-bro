# desktop

The Electron host (Windows portable EXE in production): opens the deal form and the
side panel, wires ingest → extract → resolve → fill → review, and exposes the typed
`window.fib` bridge.

## Run

```
pnpm --filter desktop dev -- --dealId=1 --formId=fixtureDeal
```

- Args (`src/main/args.ts`): `--dealId=<id> --formId=<id>` (plus `--smoke` for the
  packaging smoke test). Missing args show usage and exit 2.
- The app's own Chromium gets a loopback-only random `remote-debugging-port` set
  before `app.ready`; the fill driver attaches to it over CDP.
- `FIB_API=fake` swaps the service for `FakeApiClient`; `FIB_FAKE_FIXTURES_DIR`
  overrides its fixture directory. `FIB_SERVICE_URL` points the real client elsewhere.
- Configs load from `resources/configs` when packaged (`resolveConfigsDir`), else the
  repo's `configs/`.

## Layout

- `src/main/` — `index.ts` (bootstrap), `SessionController.ts` (the state-machine
  owner + stage side effects), `ingestService.ts` (utility-process ingest), `cdp.ts`,
  `windows.ts`, `ipc.ts`, `htmlToPdf.ts` (`printToPDF` impl of ingest's `HtmlToPdf`).
- `src/preload/` — `contextBridge` API (`window.fib`), channels from `@fib/contracts`.
- `src/renderer/` — mounts `@fib/panel`'s `App`.
- `src/ingest-worker/` — utility-process entry: `{type:'ingest',paths}` →
  `{type:'done',documentSet}` / `{type:'progress',stage}`.
- `tests/` — Playwright specs that launch the built app (`dist/main/index.js`) via
  `_electron.launch`; `e2e/` holds their fake fixtures and expected form models.

## How to test

```
pnpm --filter desktop test
```

Vitest unit tests for the main-process modules, then `electron-vite build` and the
Playwright specs (launch, session loop, edit re-push, ingest worker, missing args).
CI runs them under `xvfb-run` on Linux; Electron windows need a display or
`CI=1` (headless-new).

## Package

```
pnpm --filter desktop package   # electron-builder portable EXE
```
