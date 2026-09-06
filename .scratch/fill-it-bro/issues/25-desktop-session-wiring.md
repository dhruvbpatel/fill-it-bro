# 25: Desktop session wiring

**What to build:** The first complete loop: launch with a deal id, drop a `.msg`, the form fills itself, and the panel shows a verified status per field, with the run log posted to the service.

**Blocked by:** 11 (Core: session reducer), 19 (Executor), 20 (Fallback agent loop), 21 (Electron host shell), 22 (Ingest in utility process), 06 (TS api-client + fake)

**Status:** done

## Do exactly this
- `apps/desktop/src/main/SessionController.ts`: holds `SessionSnapshot`, applies `reduce`, broadcasts every snapshot on `session:snapshot`. Wiring: `launch` → load bundle → form view `did-finish-load` on a URL matching the template → `formReady`; `files:dropped` → `ingestService.ingestFiles` → `ingested` → `api.extract({ formId, sources: fromDocumentSet(set) })` → `extracted` → `resolve(set, result, findPhrase)` → `resolved` → `buildPlan(bundle, fields, groups, { gridRowCounts })` (count rows via driver before planning) → `Executor.run(plan, e => dispatch fillEvent)` → `fillComplete`.
- Driver: `PlaywrightDriver.connect(getCdpUrl(), new RegExp(escape(urlTemplate prefix)))` once at `formReady`.
- Fallback: `A11yFallbackAgent({ api })`; `matchOption` = core `matchOption` with llm = `api.matchOption`.
- Run log: `api.startRun` at `ingesting`; `api.logEvent` for every `FillEvent` (payload restricted to the keys allowed by ticket 09) and a final `runFinished`; failures to log are warned, never fatal.
- `ApiClient` selection: env `FIB_API=fake` → `FakeApiClient` (used by e2e), else `HttpApiClient(FIB_SERVICE_URL ?? 'http://localhost:8787')`.
- `viewer:open` and `getMergedPdf` served from the controller's current `mergedPdf`.
- Errors in any stage → `fail` with a user-readable reason; panel shows it.

## Acceptance criteria
- [x] e2e (Playwright `_electron.launch` with `FIB_API=fake`, fixture on 4300): drop `sample.msg` (via `files:dropped` IPC), wait for `review`, and `#model` in the form view equals `apps/desktop/e2e/expected/fixtureDeal.json` (author it from the fake extract fixture).
- [x] Panel shows `verified` for every scalar field and the `parties` group.
- [x] `FakeApiClient.calls` contains one `startRun` and ≥ 1 `logEvent`.
- [x] `window.__submitted` is undefined in the form view at the end.
