# Fill-It-Bro — Complete Rebuild Handoff

One document describing the entire application, every approach, and every settled
decision, so a fresh agent can rebuild the same app with the same behavior.
Generated 2026-09-12 from the as-built repo (main @ `ab5f47b` + Task 1/2 commits).
Source of truth for details: `.scratch/fill-it-bro/PLAN.md` (design + 29 tickets),
`.scratch/fill-it-bro/issues/`, package READMEs.

## 1. What the app is

Agentic web-form filler for loan deals. A user launches a portable Windows EXE with
a deal id. The app opens the deal's Angular web form (SSO) in an Electron window
with a side panel. The user drops a PDF or Outlook `.msg` into the panel. The app
parses locally, asks an LLM (via a Python service) to extract the form's fields
**with citations**, fills the form through Playwright, shows a field list. Clicking
a field jumps the PDF viewer to the highlighted source text. The human reviews and
clicks Submit themselves.

Non-negotiables:
- Human in the loop. Never auto-submit (enforced in the driver via `neverClick`).
- No documents persisted on the server. Only text items, a11y snapshots, option
  lists, quotes leave the desktop.
- Citation for every filled value (boxes on the merged PDF).
- Portable EXE deployment; configs ship with the EXE.
- Angular forms with AG Grid + an in-house searchable dropdown.

Ubiquitous language (`CONTEXT.md`): loan deal (not "run"), deal ID, source
document, extraction, fill plan (not "extraction" for assignments), form drift,
needs review, draft entry.

## 2. Architecture (two brains, one contract)

```
┌──────────────────────── Electron (Windows EXE) ────────────────────────┐
│ host-electron (main)                                                    │
│ ├─ ingest (utility process): .msg split → merged PDF + manifest         │
│ │                          LiteParse → pages[].textItems[]              │
│ ├─ fill-engine: planner → executor → adapters → verify → fallback       │
│ │    └─ BrowserDriver (Playwright over CDP to own WebContentsView)      │
│ ├─ session: state machine, events, run log client                       │
│ └─ api-client → Python service                                          │
│ panel (React, renderer): upload, field list, PDF viewer w/ highlights   │
│ WebContentsView: the deal form (SSO)                                    │
└─────────────────────────────────────────────────────────────────────────┘
               │ HTTPS (JSON only: text items, schemas, a11y snapshots)
┌──────────────▼──── Python service (FastAPI) ───────────────────────────┐
│ /extract      schema-driven structured output, per source document      │
│ /agent/step   one step of the fill fallback loop (a11y tree → action)   │
│ /match-option semantic dropdown option choice                           │
│ /runs         run-log sink                                              │
│ LLMProvider: OpenAI SDK → gateway base URL (any OpenAI-compatible LLM)  │
└─────────────────────────────────────────────────────────────────────────┘
```

Pluggable seams (interface + v1 impl + registry): `DocumentIngest` (LiteParse in
utility process), `BrowserDriver` (Playwright over CDP), `WidgetAdapter` + profile
(text, select, searchSelect, checkbox, date, agGridCell, tab, button),
`FallbackAgent` (a11y-tree tool loop via `/agent/step`), `LLMProvider` (OpenAI SDK
via gateway), `RunLogSink` (HTTP; local file in dev), `CitationRenderer` (pdf.js).

## 3. Monorepo layout

```
package.json, pnpm-workspace.yaml, uv.lock, pyproject.toml, .github/workflows/ci.yml
packages/
  contracts/        JSON Schemas (source of truth) + generated TS + Pydantic codegen
  core/             pure TS, no Electron/DOM: session machine, config loader/validator,
                    plan builder, citation resolver, option matcher (fuzzy), event types
  driver-playwright/ BrowserDriver impl (connectOverCDP, ariaSnapshot, locators)
  adapters/         WidgetAdapter registry + built-in adapters + profile schema
  fill-engine/      planner, executor, verifier, retry policy, FallbackAgent
  ingest/           msg parsing, HTML→PDF, PDF merge, LiteParse, manifest
  panel/            React UI (Vite): upload, field list, viewer, settings
  api-client/       typed fetch wrappers + FakeApiClient (canned fixtures)
apps/
  desktop/          Electron host: main, preload (contextBridge), utility wiring, packaging
  service/          FastAPI (pkg `fib_service`): routers, LLMProvider, prompt compiler
  fixture-form/     Angular fixture: reactive forms, tabs, reveal button, mock
                    searchSelect, AG Grid. DO NOT MODIFY its component behavior.
configs/forms/<formId>/ extraction.json, form.json, prompts/<fieldId>.md, widget-profiles.json
evals/harness/      extraction accuracy runner; evals/synthetic/ committed goldens
scripts/            start-service.sh, start-desktop.sh (local dev)
```

Toolchain: Node 22, pnpm 9, TS 5 strict, ESM, Vitest. Python 3.12, uv, FastAPI,
Pydantic v2, pytest, ruff. No `any`. Root scripts: `pnpm build/test/lint`,
`pnpm contracts:gen`, `pnpm validate-configs`, `pnpm fixture:serve` (:4300),
`pnpm e2e`. Python: `uv run pytest`, `uv run fib-service` (:8787), `uv run evals`.

## 4. Data contracts (`packages/contracts`, JSON Schema → TS + Pydantic)

- **DocumentSet** (client-side; only `pages[].items` text goes to server):
  `{ setId, sources[{sourceId, kind: emailBody|attachment|upload, name, mime}], mergedPdf (client only), manifest[{mergedPage, sourceId, sourcePage}], pages[{mergedPage, w, h, items[{id, text, x, y, w, h}]}] }`. Item ids `p3i17`.
- **ExtractionRequest**: `{ formId, sources[{sourceId, pages[{mergedPage, items[{id,text}]}]}] }`, rendered as `[p3i17] text` lines; LLM cites item ids, never coords.
- **ExtractionResult**: `{ runId, fields[{fieldId, value, valueType, status: found|notFound|ambiguous, confidence, sourceId, citations[{itemIds, quote}], reason?}], groups[{groupId, rows[{cells}]}] }`.
- **Citation resolution** (core, client): itemIds → boxes; quote must be substring
  of joined text (fuzzy ≥ 0.9) else `searchItems` phrase fallback, else
  `unverifiedCitation` + confidence capped.
- **FormConfig** (`form.json`): sections mirroring human fill order; fields with
  `control`, locator (`formControlName|label|role|css`), `profile`, `dependsOn`;
  grids with `addRow`; tabs via `navigateTab`, hidden fields via `reveal` clicks.
- **ExtractionConfig** (`extraction.json`): per-field `type, description` (or
  `promptFile`), `required, examples, enum`; groups for grids. Same `fieldId` in
  both configs, enforced by `validate-configs`.
- **FillPlan / FillEvent**: flattened `[navigateTab, reveal, fillField, addRow, fillCell]`; events `stepStarted|stepVerified|stepRetrying|stepFallback|stepFailed|stepSkipped`.

## 5. Session state machine (`packages/core/src/session.ts`, pure reducer)

`idle → launching → formReady → ingesting → extracting → resolving → filling → review → done`, `failed(reason)` from anywhere, `review → filling` on user edit
(single-field re-push). Illegal transitions throw `IllegalTransition`.
As-built Task 2 (drop-anytime): `filesDropped` is legal from
`formReady` (plain → `ingesting`) AND from `review|done|failed` (→ `ingesting`
with `documentSet/extraction/fields/fillEvents/error` cleared, `dealId/formId`
kept). One session per window.

## 6. Ingest (utility process, `packages/ingest`)

PDF → single source. `.msg` → `@kenjiuno/msgreader`: body HTML → PDF via hidden
`webContents.printToPDF` (no LibreOffice); image attachments → PDF pages via
`pdf-lib`; merge body-first in order + manifest; LiteParse (Node, OCR on for image
pages) → `pages[].items` in PDF points; temp files deleted. `findPhrase` stitches
adjacent items for fallback search.

## 7. Extraction service (`apps/service`, FastAPI, stateless, never persists docs)

- `POST /extract`: per source per field-group, one structured-output call. Prompt
  = system template + compiled schema with BA prompts (`prompts/<fieldId>.md`
  overrides inline description) + `[itemId] text` pages. Forces
  `{value, itemIds, quote, confidence, reason}` per field, nulls allowed for
  `notFound`. Grids extract as row-object arrays. Validated vs contract.
- `POST /agent/step`: `{goal, fieldSpec, a11ySnapshot, history}` → exactly one
  tool `click|type|press|waitFor|readValue|done|giveUp`. System prompt
  `prompts/agent_step.md`.
- `POST /match-option`: `{wanted, options[]}` → `{index|null, confidence, reason}`.
- `POST /runs`, `/runs/{id}/events`: run-log sink (names, timestamps, outcomes,
  quotes only). `DUMP_EXTRACTION_DIR` dev toggle mirrors traffic.
- Providers: `LLMProvider{structured, tool_step}`. `OpenAIProvider` uses Responses
  API `text.format=json_schema`, fallback to chat-completions JSON mode on 4xx.
  `FakeProvider` canned fixtures. Selected by `PROVIDER=openai|fake`.
- Settings env only: `GATEWAY_BASE_URL`, `GATEWAY_API_KEY`, `MODEL` (default
  `gpt-4o`), `PROVIDER`, `PORT` (8787). As-built: Muse Spark 1.3 runs as
  `GATEWAY_BASE_URL=https://api.meta.ai/v1 MODEL=muse-spark-1.3` (exact name;
  `-contributor` suffix is invalid).

## 8. Fill engine (`packages/fill-engine` + `core/plan` + `core/match`)

Planner: FormConfig + resolved fields → FillPlan (skip empty, section order,
tab/reveal steps, grid `addRow` expansion). Per-step executor:
1. `adapter = registry.get(control)`, profile from `widget-profiles.json`.
2. Attempt loop (default 3, backoffs `[300,800,1500]`, per-control override):
   `adapter.write` (always clears first → idempotent retries) then `adapter.read`
   + control-aware equality (trim, number/date normalize). Match → `stepVerified`.
3. Exhausted → `FallbackAgent.run(step)` (budget ~3 attempts/20s): `ariaSnapshot`
   region → `/agent/step` → execute tool via driver → re-verify. `done` →
   `filledByAgent`; `giveUp` → `stepFailed` with reason surfaced.
4. Driver-level `neverClick` (Submit/Save/Delete) — `click()` throws.
- **searchSelect** (Task 1 as-built): trigger → type → loading hidden →
  `waitStable(optionList, settleMs, maxWaitMs≈5s)` → collect options →
  `matchOption`: exact → normalized → fuzzy (token ratio ≥ 0.9, unique) → LLM →
  click → verify `selectedValue`. Post-pick AND error paths run best-effort
  trigger re-click (`closePanelBestEffort`: if option list attached, click trigger;
  failures logged, never mask the pick/original error) — fixes fixture `<label>`
  click-forwarding reopen + the old no-op Escape. Fuzzy/LLM picks surface as
  `needsReview`.
- **agGridCell**: ensure row (`addRow` + row count wait), cell by `col-id`,
  double-click/Enter, delegate to inner control adapter, Enter commit, read back.

## 9. BrowserDriver (`packages/driver-playwright`)

`connectOverCDP` to Electron's Chromium (loopback random port pre-`app.ready`),
page matched by deal-URL regex. Locator precedence
`formControlName → label → role → css` (+`within/nth`). Methods:
`click/type/fill/selectByLabel/press/readValue/readText/count/waitFor/waitStable`
(innerText unchanged for `settleMs`)/`ariaSnapshot` (ref-injected `[ref=eN]`)/
`refToLocator/setNeverClick`. Refuses pages outside the form origin.

## 10. Panel (`packages/panel`, React+Vite, no Node imports in renderer)

States from snapshot: DropZone (Task 2: visible whenever NOT in-flight
`ingesting/extracting/resolving/filling`, so never beside ProgressBar; enabled
even in `failed`; sibling of viewer pane) → ProgressBar → field list with badges
`verified|filledByAgent|needsReview|lowConfidence|notFound|failed`, attention-first
sort → click field → pdf.js viewer jumps to `mergedPage`, boxes scaled
`viewport.scale/72`, "from \<name\>, page N", pulse animation → inline edit
re-pushes single field. Bridge: typed `contextBridge window.fib` (channels from
contracts), `MemoryPanelApi` for tests, `?standalone` Vite dev at :5173.

## 11. Desktop host (`apps/desktop`)

Parses `--dealId/--formId`, loads `templates.json` URL, `WebContentsView` form +
panel views, CDP port, `SessionController` (reducer + ingest + api-client +
executor + driver, IPC snapshot streaming, run-log client), `getMergedPdf`
(empty bytes when null; Task 2 clears cached PDF on re-drop before ingest so the
viewer can't serve stale bytes), preload `window.fib` (+ `pathForFile` via
`webUtils.getPathForFile` for Electron 32+). Packaging: electron-builder portable
EXE + service container job.

## 12. Config authoring

`configs/forms/<formId>/{extraction.json, form.json, widget-profiles.json, prompts/<fieldId>.md}`.
BAs own extraction prompts; devs own form/profile locators. `pnpm validate-configs`
checks schemas, field-id parity, locator presence, profile refs. Bundled into EXE
(`resources/configs`); a future fetch-loader is a drop-in. Fixture `formId =
fixtureDeal`: tabs Deal/Parties, `issuerName` searchSelect (1500ms async options incl.
"Goldman Sachs Incorporated"), amount/currency/date/checkbox, "Add fees" reveal,
AG Grid parties + Add row, Submit (never clicked), `<pre id=model>` JSON for tests.

## 13. Eval + tests + CI

- Eval harness: `uv run evals --forms configs/forms --golden $GOLDEN_DIR --provider
  fake|openai` → per-field exact/normalized/fuzzy accuracy + citation-id checks →
  markdown+JSON report. CI runs committed `evals/synthetic`; real goldens on a share.
- TDD everywhere: Vitest table tests (reducer), component tests (panel), Playwright
  vs fixture (adapters/driver/executor incl. delayed dropdown, grid, broken-locator
  fallback recovery), pytest with FakeProvider + contract round-trips.
- CI: one workflow, path-filtered `ts/py/fixture` jobs; deploys: EXE + service.

## 14. Run it (as-built)

```bash
pnpm install && pnpm build
FIB_API=fake ./scripts/start-desktop.sh            # no key; fixture :4300 auto
# real LLM:
GATEWAY_BASE_URL="https://api.meta.ai/v1" GATEWAY_API_KEY="$MODEL_API_KEY" MODEL="muse-spark-1.3" ./scripts/start-service.sh  # :8787
./scripts/start-desktop.sh                         # needs terminal 1
pnpm e2e                                           # full loop w/ fake service
pnpm --filter @fib/core test; pnpm --filter @fib/panel test
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE -u PLAYWRIGHT_BROWSERS_PATH ./node_modules/.bin/playwright test
```

Env knobs: `PORT, MODEL, PROVIDER(openai|fake), FIXTURE_PORT(4300),
FIXTURE_HOST(127.0.0.1), FIB_SERVICE_URL`. Local-run guide: root README
"Run it locally". Gotchas: unset `ELECTRON_RUN_AS_NODE` + `PLAYWRIGHT_BROWSERS_PATH`
(empty Cursor cache breaks browser spawn); rebuild `@fib/core` dist + `electron-vite
build` before desktop Playwright; `pnpm validate-configs` after config edits.

## 15. Settled decisions log (condensed from PLAN interviews)

Topology: FastAPI service separate from EXE. Brains: extraction Python-side, fill
engine TS in Electron. LLM via OpenAI-compatible gateway (Muse Spark proven).
Forms: internal SSO Angular. Attach: Playwright-over-CDP into own Chromium (no
browser-use; Stagehand future plugin). Inputs: PDF + Outlook .msg (PDF/image
attachments; inline image tables). Nothing persisted server-side. Citations:
bounding boxes. Spectrum: config-first + per-field prompts + fallback agent
(discovery agent deferred). Confidence shown; eval harness on extraction JSON;
run log to service. One fill at a time; deal id CLI arg; parallel later.
Parsing in UI utility process (`DocumentIngest`). All LLM calls via service.
URL templates JSON `{dealId}`. Monorepo, one CI, two deploys. Node 22, current
Electron WebContentsView, pnpm, Vite, Py 3.12+uv, OpenAI SDK, Pydantic v2,
Vitest/Playwright/pytest. Goldens outside repo; synthetic set in repo.

## 16. Explicitly deferred (do not build)

Form-discovery agent drafting `form.json`, parallel multi-window sessions,
Chrome-extension host, Stagehand plugin, auto-submit (gated on evals), Anthropic
provider, Office-input support (LibreOffice), server-side parsing.

## 17. Latest WIP (landed as `wip:` commit, unreviewed — verify before building on it)

- **Renderer file paths on Electron 32+** (`apps/desktop/src/preload/index.ts`,
  `packages/panel/src/components/DropZone.tsx` + test): Electron removed
  `File.path`, so the preload exposes `pathForFile(file)` via
  `webUtils.getPathForFile`; `filePaths()` prefers the bridge, then legacy
  `File.path`, then `file.name`. Without this, dropped files resolve to bare
  filenames and ingest can't find them.
- **Settlement eval fixtures** (`packages/ingest/fixtures/settlement_simple.*`,
  `settlement_table.*` PDF + DocumentSet pairs): golden inputs for extraction
  accuracy runs; real goldens otherwise live outside the repo.
- **Fixture cache off** (`apps/fixture-form/angular.json`): Angular CLI cache
  disabled for reproducible fixture serves in CI/dev.
- **Orchestrate default model** (`.scratch/fill-it-bro/orchestrate/dispatch-opencode.sh`):
  default wave model `zai-coding-plan/glm-5.3-flash`.
- Still local-only, NOT pushed: `.claude/`, `.serena/`, orchestrate `logs/`,
  `runs.jsonl`.
