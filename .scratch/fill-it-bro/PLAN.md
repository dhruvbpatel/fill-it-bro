# Fill-It-Bro: Agentic Web-Form Filling with Citations

Status: **design settled (4 interview rounds, 2026-09-04) — ready to implement.**
Decision log with every settled question is at the bottom of this file.

## 1. Context

Rebuild, from scratch, of an internal finance tool. A user launches a portable Windows EXE with a deal id. The app
opens the deal's Angular web form (SSO) in an Electron window with a side panel. The user drops a PDF or an Outlook
.msg into the panel. The app parses it locally, asks an LLM (through the internal gateway, via a Python service) to
extract the form's fields **with citations**, fills the form through Playwright, and shows a field list. Clicking a
field jumps the PDF viewer to the exact highlighted source text. The human reviews and clicks Submit themselves.

Problems with the current build that this design fixes:
- Filling is brittle: searchable dropdowns with async options race and fail; no retry, no verification.
- Onboarding a new form means hand-writing prompts and locators with no structure or validation.
- Multi-document inputs (email + attachments) lose provenance.
- Everything is wired together; parsers, LLM, driver, UI cannot be swapped.

Non-negotiables: human in the loop (never auto-submit), no documents persisted on the server, citations for every
filled value, portable EXE deployment, Angular forms with AG Grid and an in-house searchable dropdown.

## 2. Architecture

Two brains, one contract.

```
┌──────────────────────── Electron (Windows EXE) ────────────────────────┐
│  host-electron (main)                                                   │
│   ├─ ingest (utility process): .msg split → merged PDF + manifest       │
│   │                            LiteParse → pages[].textItems[]           │
│   ├─ fill-engine: planner → executor → adapters → verify → fallback     │
│   │      └─ BrowserDriver (Playwright over CDP to own WebContentsView)  │
│   ├─ session: state machine, events, run log client                     │
│   └─ api-client → Python service                                        │
│  panel (React, renderer): upload, field list, PDF viewer w/ highlights  │
│  WebContentsView: the deal form (SSO)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                 │ HTTPS (JSON only: text items, schemas, a11y snapshots)
┌────────────────▼──── Python service (FastAPI) ─────────────────────────┐
│  /extract      schema-driven structured output, per source document     │
│  /agent/step   one step of the fill fallback loop (a11y tree → action)  │
│  /match-option semantic dropdown option choice                          │
│  /runs         run-log sink                                             │
│  LLMProvider: OpenAI SDK → internal gateway (Claude-compatible later)   │
└─────────────────────────────────────────────────────────────────────────┘
```

Pluggable seams (each is an interface with one v1 implementation and a registry):
| Seam | Interface | v1 impl | Future |
|---|---|---|---|
| Document parsing | `DocumentIngest` | LiteParse in utility process | server-side parser |
| Browser control | `BrowserDriver` | Playwright over CDP | Chrome extension host, embedded SDK |
| Widget behaviour | `WidgetAdapter` + profile | text, select, searchSelect, checkbox, date, agGridCell, tab, button | per-library adapters |
| Fill fallback | `FallbackAgent` | a11y-tree tool loop via `/agent/step` | Stagehand plugin |
| LLM | `LLMProvider` (py) | OpenAI SDK via gateway | Anthropic via gateway |
| Run log | `RunLogSink` | HTTP to service; local file in dev | anything |
| Viewer renderer | `CitationRenderer` | pdf.js + box overlay | text renderer |

## 3. Monorepo layout

```
fill-it-bro/
  package.json  pnpm-workspace.yaml  uv.lock  pyproject.toml (workspace)  .github/workflows/ci.yml
  packages/
    contracts/        JSON Schemas (source of truth) + generated TS types  + codegen script → apps/service models
    core/             pure TS, no Electron/DOM imports: session state machine, config loader/validator,
                      plan builder, citation resolver, option matcher (fuzzy), event types
    driver-playwright/ BrowserDriver impl (connectOverCDP, ariaSnapshot, locators)
    adapters/         WidgetAdapter registry + built-in adapters + profile schema
    fill-engine/      planner, executor, verifier, retry policy, FallbackAgent
    ingest/           DocumentIngest impl: msg parsing, HTML→PDF, PDF merge, LiteParse, manifest
    panel/            React UI (Vite): upload, field list, viewer, settings
  apps/
    desktop/          Electron host: main, preload (contextBridge), utility process wiring, packaging
    service/          FastAPI: routers, LLMProvider, prompt compiler, run-log sink
    fixture-form/     Angular app: reactive forms, tabs, reveal button, mock searchSelect, AG Grid
  configs/
    forms/<formId>/extraction.json  form.json  prompts/<fieldId>.md  widget-profiles.json
    templates.json    formId → URL template with {dealId}
  evals/
    harness/          python: run extraction over golden set, per-field accuracy report
    synthetic/        generated small golden set committed for CI (real goldens live on a share, env var path)
```

CI: one workflow with path filters (ts, py, fixture). Deploy: two jobs, EXE (electron-builder portable) and service.

## 4. Data contracts (`packages/contracts`, JSON Schema → TS + Pydantic)

**DocumentSet** (produced by ingest, stays on the client; only `pages[].items` text goes to the server)
```
{ setId, sources: [{ sourceId, kind: "emailBody"|"attachment"|"upload", name, mime }],
  mergedPdf: <bytes, client only>,
  manifest: [{ mergedPage, sourceId, sourcePage }],
  pages: [{ mergedPage, width, height, items: [{ id, text, x, y, w, h }] }] }
```
Item ids are stable strings like `p3i17`. This is what makes citations verifiable.

**ExtractionRequest** → service: `{ formId, sources: [{ sourceId, pages: [{ mergedPage, items:[{id,text}] }] }] }`
The service formats each page as `[p3i17] text` lines; the LLM cites item ids, never coordinates.

**ExtractionResult** ← service
```
{ runId, fields: [{ fieldId, value, valueType, status: "found"|"notFound"|"ambiguous",
                    confidence: 0..1, sourceId, citations: [{ itemIds: [..], quote }], reason? }],
  groups: [{ groupId, rows: [ { cells: [<field-like>] } ] }] }
```
Client-side **citation resolution** (core): itemIds → boxes from DocumentSet; verify `quote` is a substring of the
joined item text (fuzzy ≥ 0.9); if ids are bad, fall back to `searchItems`-style phrase search; if still nothing,
status becomes `"unverifiedCitation"` and confidence is capped. Result: `Citation = { mergedPage, boxes[], quote,
sourceId, sourcePage }`.

**FormConfig** (`form.json`): ordered sections that mirror how a human fills the form.
```
{ formId, urlTemplate, widgetProfiles: "./widget-profiles.json",
  sections: [
    { id, tab?: { locator }, reveal?: [{ action: "click", locator }],
      fields: [{ fieldId, control: "text"|"select"|"searchSelect"|..., locator: { formControlName?|label?|role?|css? },
                 profile?, required?, dependsOn?: [fieldId] }],
      grids: [{ groupId, control: "agGrid", locator, addRow?: { locator }, columns: [{ fieldId, colId, control }] }] } ] }
```
**ExtractionConfig** (`extraction.json`): `{ formId, fields: [{ fieldId, type, description (BA prompt, or promptFile),
required, examples, enum? }], groups: [{ groupId, description, fields: [...] }] }`. Both validated at load; the same
`fieldId` must appear in both, checked by a `validate-configs` script.

**FillPlan / FillEvent**: plan = flattened ordered steps `[navigateTab, reveal, fillField, addRow, fillCell]`;
events stream to the panel: `stepStarted | stepVerified | stepRetrying(attempt, reason) | stepFallback | stepFailed(reason) | stepSkipped(noValue)`.

## 5. Session state machine (core, framework-free)

`Idle → Launching(dealId) → FormReady → Ingesting → Extracting → Resolving → Filling → Review → Done`
with `Failed(reason)` reachable from any state and `Review → Filling` on user edit (re-push single field).
One session per window; session id everywhere so parallel windows are a later additive change.

## 6. Ingest pipeline (`packages/ingest`, runs in an Electron utility process)

1. Detect type. PDF → single source. `.msg` → parse with `@kenjiuno/msgreader`: body (HTML or text), attachments.
2. Email body → HTML → PDF via a hidden Electron `webContents.printToPDF` (no LibreOffice). Inline images stay in
   the body render; image attachments become their own pages (image → PDF page).
3. Merge with `pdf-lib`: body first, then attachments in order. Build **manifest** while appending.
4. LiteParse (Node) on the merged PDF with OCR on for image pages → `pages[].items` with boxes in PDF points.
5. Emit `DocumentSet`. Never touch disk except an OS temp file for LiteParse if it requires a path; delete after.

Verification: unit tests with a synthetic .msg containing a PDF and an image; assert manifest page mapping and that
`searchItems` finds a known phrase on the expected merged page.

## 7. Extraction service (`apps/service`)

- `POST /extract`: for each source, build one structured-output call per field group (fields default to one group;
  large forms can declare groups to keep schemas small). Prompt = system template + compiled schema whose property
  descriptions are the BA prompts (`prompts/<fieldId>.md` or inline description) + page text with item ids.
  Response schema forces `{ value, itemIds, quote, confidence, reason }` per field, `null` allowed.
- Groups (grids) extract as arrays of row objects with per-cell citations.
- `LLMProvider` protocol: `structured(schema, messages)`, `tool_step(tools, messages)`. OpenAI impl uses the
  Responses API with `text.format = json_schema` against the gateway base URL. Provider chosen by env.
- `POST /agent/step`: input `{ goal, fieldSpec, a11ySnapshot, history }`, output one tool call from a fixed tool set
  (`click(ref) | type(ref,text) | press(key) | waitFor(refOrText, ms) | readValue(ref) | done(value) | giveUp(reason)`).
  Server is stateless; the client owns the loop and budget.
- `POST /match-option`: `{ wanted, options[] }` → `{ index | null, confidence, reason }`. Only called when fuzzy
  matching in core is not decisive.
- `POST /runs` and `POST /runs/{id}/events`: run-log sink (user, timestamps, source names, per-field outcomes, quotes).
  No document text beyond quotes.
- Dev toggle `DUMP_EXTRACTION_DIR`: mirrors what today's local dump does.

Verification: pytest with a fake provider returning canned JSON; contract tests that generated Pydantic models
round-trip the JSON Schemas; one recorded-response test against the gateway behind an env flag.

## 8. Fill engine (`packages/fill-engine`, Electron main process)

**Planner** (core): FormConfig + resolved ExtractionResult → FillPlan. Skips fields with no value, orders by section,
inserts `navigateTab`/`reveal` steps, expands grid rows (`addRow` when the grid has fewer rows than extracted).

**Executor** per step:
1. `adapter = registry.get(step.control)`; `profile = widgetProfiles[step.profile]`.
2. Attempt loop (default 3, per-control override): `adapter.write(...)` then `adapter.read(...)` and compare with a
   control-aware equality (trimmed, number/date normalised). Success → `stepVerified`.
3. On mismatch/timeout: retry with backoff. Retries are idempotent because every adapter clears before writing.
4. After retries: `FallbackAgent.run(step)` with budget (attempts 3, 20 s). It takes an `ariaSnapshot` of the
   region, calls `/agent/step`, executes the returned tool through `BrowserDriver`, re-verifies. `done` → verified
   with status `filledByAgent`; `giveUp` → `stepFailed` shown to the user with the reason.
5. Never clicks anything matching a `neverClick` list in config (Submit, Save, Delete) — enforced in the driver.

**searchSelect adapter** (the race fix): open via profile trigger → type value → wait until option list is
*stable* (same DOM text for `settleMs`, loading indicator gone, hard cap `maxWaitMs` ≈ 5 s) → collect option texts →
`core.optionMatcher`: exact → normalised exact → fuzzy (rapidfuzz-style token ratio ≥ 0.9 and unique) → else
`/match-option` → pick or fail. LLM-picked or fuzzy-picked values get status `needsReview` in the panel.

**agGridCell adapter**: locate grid by profile, ensure row exists (click addRow, wait row count), find cell by
`col-id`, double-click or Enter to start editing, delegate to the cell's inner control adapter (text/select/searchSelect),
commit with Enter, read back cell text.

**BrowserDriver** (Playwright): `connectOverCDP` to Electron's own Chromium (`remote-debugging-port` bound to
127.0.0.1, random free port, set before `app.ready`), find the page whose URL matches the deal form. Exposes:
`locate(locatorSpec)`, `ariaSnapshot(scope)`, `click/type/press/waitFor/readValue`, `refToLocator(ref)`.

Verification: Playwright tests against `apps/fixture-form` covering: text, select, tabs, reveal, delayed non-exact
searchSelect ("Goldman Sachs" → "Goldman Sachs Incorporated"), AG Grid add-row + cell edit, a deliberately broken
locator that must be recovered by the fallback agent using a fake `/agent/step`. Retry policy unit-tested with a
flaky fake adapter.

## 9. Panel UI (`packages/panel`, React + Vite)

- Drop zone → ingest progress → extraction progress → live field list with status badge per field:
  `verified | filledByAgent | needsReview | lowConfidence | notFound | failed`, sorted so attention items float.
- Click field → viewer (`pdfjs-dist` canvas + absolutely positioned highlight boxes scaled by `viewport.scale/72`)
  jumps to `mergedPage`, shows "from <source name>, page N" from the manifest, animates the boxes.
- Edit value inline → re-push through the engine (same path) → status updates.
- Talks to main only through a typed `contextBridge` API (`ipc` channel names generated from `contracts`).
- Settings drawer: service URL, dev dump toggle (dev builds only).

Verification: Vitest component tests; a Playwright e2e that runs the whole loop against fixture-form with the fake
service.

## 10. Config and prompt authoring

`configs/forms/<formId>/` holds `extraction.json` (BAs), `prompts/<fieldId>.md` (BAs, optional long-form),
`form.json` (developers), `widget-profiles.json` (developers). `pnpm validate-configs` checks schemas, field-id parity,
locator presence, and that every `profile` referenced exists. Configs are bundled into the EXE (as today); the
loader reads from `resources/configs` so a later "fetch from service" loader is a drop-in.

## 11. Eval harness (`evals/harness`)

`uv run evals --forms configs/forms --golden $GOLDEN_DIR --provider openai` → for each golden `(documentSet.json,
expected.json)` run `/extract` logic in-process, compare per field (exact, normalised, fuzzy), check citation ids point
at text containing the value, emit a markdown + JSON report. CI runs it on `evals/synthetic`. Real goldens live on a
share. Same harness later supports model comparison (`--provider anthropic`).

## 12. Security and data handling

- No gateway credential in the EXE; all LLM traffic via the service. Service auth: whatever the firm's service mesh
  provides (assume bearer/SSO header, pluggable middleware).
- Only text items, a11y snapshots, and option lists leave the desktop. No screenshots. No document bytes.
- CDP port loopback-only and random; the driver refuses to attach to pages outside the form URL's origin.
- Run log stores names, timestamps, field outcomes, quotes. Nothing else.

## 13. Milestones (each ends green in CI)

| # | Deliverable | Verified by |
|---|---|---|
| M0 | Monorepo scaffold, contracts + codegen, CI, fixture-form skeleton | `pnpm -r build`, `uv run pytest`, fixture serves |
| M1 | Ingest: .msg/PDF → merged PDF + manifest + LiteParse items | ingest unit tests on synthetic .msg |
| M2 | Service `/extract` with structured outputs + citation ids; dev dump; eval harness on synthetic set | pytest, eval report |
| M3 | Core: config loader/validator, planner, citation resolver, option matcher | Vitest |
| M4 | Driver + adapters + executor + retry; fixture tests incl. dropdown race and AG Grid | Playwright suite |
| M5 | Fallback agent (`/agent/step`) + `/match-option`; broken-locator recovery test | Playwright + pytest |
| M6 | Electron host: deal-id launch, WebContentsView, CDP attach, utility process, panel with viewer/highlights, re-push, run log | e2e against fixture; manual run on a real form |
| M7 | Portable EXE packaging; deploy job | EXE launches from a share on a Windows VM |

Deferred (explicitly out of v1): form-discovery agent that drafts `form.json` (design hook: it reuses `BrowserDriver`
+ `ariaSnapshot` + `formControlName` enumeration), parallel multi-window sessions, Chrome-extension host, Stagehand
plugin, auto-submit (gated on eval results), Anthropic provider.

## 14. Risks to watch

- LiteParse Node native module must be packaged for Electron (rebuild against Electron ABI or use the WASM build).
  Decide in M1 by measuring OCR speed of both.
- `printToPDF` fidelity for Outlook HTML bodies with inline images; fallback is plain-text body render.
- In-house dropdown DOM is unknown until snippets arrive; the profile schema must be finalised against them in M4.
- Responses API structured-output support in the gateway; fall back to chat completions + JSON mode if missing.

---

## 15. Ticket pack (for low-reasoning agents, parallel orchestration)

### Global conventions every ticket inherits (do not re-decide)
- Node 22, pnpm 9 workspaces, TypeScript 5 strict, ESM, Vitest. Python 3.12, uv, FastAPI, Pydantic v2, pytest, ruff.
- Package names: `@fib/contracts`, `@fib/core`, `@fib/driver-playwright`, `@fib/adapters`, `@fib/fill-engine`,
  `@fib/ingest`, `@fib/panel`, `@fib/api-client`; apps `apps/desktop`, `apps/service` (python pkg `fib_service`),
  `apps/fixture-form`; `configs/`; `evals/`.
- Root scripts: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm contracts:gen`, `pnpm validate-configs`,
  `pnpm fixture:serve` (port 4300), `pnpm e2e`. Python: `uv run pytest`, `uv run fib-service` (port 8787), `uv run evals`.
- Every ticket: add tests in the same package, run the package's test command, CI green. No `any`. No new deps
  beyond those named in the ticket without a comment explaining why.
- Interfaces below are **final**. Implement exactly; do not rename.
- Fake service for TS tests: `packages/api-client/src/fake.ts` (T06) returns canned responses from JSON fixtures.
- `fieldId` strings are `camelCase`; `formId` for the fixture is `fixtureDeal`; `dealId` is a string.

### Key interfaces (copy verbatim)
```ts
// @fib/core  session.ts
export type SessionState = 'idle'|'launching'|'formReady'|'ingesting'|'extracting'|'resolving'|'filling'|'review'|'done'|'failed';
export type SessionEvent =
  | {type:'launch';dealId:string;formId:string} | {type:'formReady'} | {type:'filesDropped';paths:string[]}
  | {type:'ingested';documentSet:DocumentSet} | {type:'extracted';result:ExtractionResult}
  | {type:'resolved';fields:ResolvedField[]} | {type:'fillEvent';event:FillEvent} | {type:'fillComplete'}
  | {type:'userEdit';fieldId:string;value:string} | {type:'fail';reason:string};
export function reduce(s: SessionSnapshot, e: SessionEvent): SessionSnapshot;   // pure, throws on illegal transition

// @fib/driver-playwright  driver.ts (interface lives in @fib/core/driver.ts)
export interface LocatorSpec { formControlName?:string; label?:string; role?:{name:string;role:string}; css?:string; within?:LocatorSpec; nth?:number }
export interface BrowserDriver {
  connect(cdpUrl:string, pageUrl:RegExp): Promise<void>;
  click(t:LocatorSpec|Ref): Promise<void>; type(t:LocatorSpec|Ref, text:string, opts?:{clear?:boolean}): Promise<void>;
  press(t:LocatorSpec|Ref, key:string): Promise<void>; readValue(t:LocatorSpec|Ref): Promise<string|null>;
  readText(t:LocatorSpec|Ref): Promise<string>; count(t:LocatorSpec): Promise<number>;
  waitFor(t:LocatorSpec|Ref, state:'visible'|'hidden'|'attached', timeoutMs:number): Promise<void>;
  waitStable(t:LocatorSpec, settleMs:number, maxMs:number): Promise<void>;  // resolves when innerText unchanged for settleMs
  ariaSnapshot(scope?:LocatorSpec): Promise<{ yaml:string; refs:string[] }>;   // refs like "e12" usable as Ref
  setNeverClick(patterns:LocatorSpec[]): void;   // click() throws NeverClickError if target matches
}
export type Ref = { ref:string };

// @fib/adapters  adapter.ts
export interface AdapterCtx { driver:BrowserDriver; matchOption:(wanted:string, options:string[])=>Promise<{index:number|null; via:'exact'|'fuzzy'|'llm'; confidence:number}>; log:(msg:string)=>void }
export interface WidgetAdapter {
  control: 'text'|'select'|'searchSelect'|'checkbox'|'date'|'button'|'tab'|'agGridCell';
  write(ctx:AdapterCtx, target:LocatorSpec, value:string, profile?:WidgetProfile): Promise<{via?:'exact'|'fuzzy'|'llm'}>;
  read(ctx:AdapterCtx, target:LocatorSpec, profile?:WidgetProfile): Promise<string|null>;
  options?(ctx:AdapterCtx, target:LocatorSpec, profile?:WidgetProfile): Promise<string[]>;
}
export const registry: Map<WidgetAdapter['control'], WidgetAdapter>;

// @fib/fill-engine  types.ts
export interface RetryPolicy { attempts:number; backoffMs:number[] }          // default {attempts:3, backoffMs:[300,800,1500]}
export interface FallbackAgent { run(step:FillStep, ctx:AdapterCtx, budget:{attempts:number; timeoutMs:number}): Promise<{ok:true; value:string}|{ok:false; reason:string}> }
export interface Executor { run(plan:FillPlan, onEvent:(e:FillEvent)=>void): Promise<FillReport> }
```
Widget profile schema (`widget-profiles.json`, keyed by profile name):
```json
{ "fixtureSearchSelect": { "trigger": {"css": ".fib-select__trigger"}, "searchInput": {"css": ".fib-select__search"},
  "optionList": {"css": ".fib-select__options"}, "optionItem": {"css": ".fib-select__option"},
  "loadingIndicator": {"css": ".fib-select__loading"}, "selectedValue": {"css": ".fib-select__value"},
  "settleMs": 300, "maxWaitMs": 5000 } }
```

### Tickets (numbered in dependency order; "Blocked by" lists numbers)

**T01 Monorepo scaffold** — Blocked by: none.
Create the layout in §3 with empty packages that build, root scripts, `.github/workflows/ci.yml` with path-filtered
jobs `ts`, `py`, `fixture`, Prettier + ESLint (typescript-eslint, no `any`), ruff, `uv` workspace with `apps/service`
and `evals/harness`. AC: `pnpm build && pnpm test && pnpm lint` and `uv run pytest` pass on empty packages; CI green.

**T02 Contracts + codegen** — Blocked by: T01.
Write JSON Schemas under `packages/contracts/schemas/` for: `document-set`, `extraction-request`, `extraction-result`,
`resolved-field`, `citation`, `form-config`, `extraction-config`, `widget-profiles`, `fill-plan`, `fill-event`,
`fill-report`, `agent-step-request/response`, `match-option-request/response`, `run-log-event`, exactly as in §4 and
§7. `pnpm contracts:gen` runs `json-schema-to-typescript` → `packages/contracts/src/generated/` and
`datamodel-code-generator` → `apps/service/src/fib_service/contracts/`. Commit generated output. AC: gen is
idempotent (CI fails if diff), one round-trip test per schema in TS and Python using `examples/*.json` fixtures.

**T03 Ingest: PDF → DocumentSet** — Blocked by: T02.
`@fib/ingest`: `ingest(files:string[]): Promise<DocumentSet>` for a single PDF: run LiteParse (Node package, OCR on),
map to `pages[].items` with ids `p{page}i{index}`, manifest is identity, `sources=[{kind:'upload'}]`. Include
`findPhrase(set, phrase): {mergedPage, itemIds}[]` (stitch adjacent items). Decide Node-native vs WASM by measuring
a 10-page scanned fixture; record choice in `packages/ingest/README.md`. AC: fixture `fixtures/simple.pdf` yields a
known phrase at expected page with boxes > 0.

**T04 Ingest: .msg → merged PDF + manifest** — Blocked by: T03.
Parse `.msg` with `@kenjiuno/msgreader`; body HTML → PDF via an `HtmlToPdf` interface (Electron impl in T21; test
impl uses `puppeteer-core`-free path: Playwright chromium `page.pdf` in tests); image attachments → PDF pages via
`pdf-lib`; merge body + attachments in order; build manifest; run T03 parse on merged PDF. AC: synthetic `.msg`
(body + 2-page PDF + PNG) → 4 merged pages, manifest maps page 3 → attachment 1 page 2, phrase in PNG found via OCR.

**T05 Service skeleton + LLMProvider** — Blocked by: T02.
`apps/service`: FastAPI app, settings (`GATEWAY_BASE_URL`, `GATEWAY_API_KEY`, `MODEL`, `DUMP_EXTRACTION_DIR`),
`LLMProvider` Protocol `structured(schema, messages)->dict` and `tool_step(tools, messages)->ToolCall`, `OpenAIProvider`
(Responses API, `text.format=json_schema`, fallback to chat completions JSON mode if 4xx on format), `FakeProvider`
(returns fixture JSON keyed by schema title). `/healthz`. AC: pytest with FakeProvider; provider selected by env.

**T06 TS api-client + fake** — Blocked by: T02.
`@fib/api-client`: typed `fetch` wrappers for `/extract`, `/agent/step`, `/match-option`, `/runs`, `/runs/{id}/events`
using generated types; `FakeApiClient` serving JSON from `fixtures/`. AC: unit tests for serialization and error mapping.

**T07 Service /extract** — Blocked by: T05.
Prompt compiler: `extraction.json` fields → JSON schema whose property descriptions = `prompts/<fieldId>.md` or inline
description; page text formatted `[p3i17] text` per line; one call per source per group; output validated against
`extraction-result`. Dev dump when `DUMP_EXTRACTION_DIR` set. AC: FakeProvider returns citations; test asserts
per-source chunking and that `notFound` fields come back `null` with `status:'notFound'`.

**T08 Service /agent/step** — Blocked by: T05.
Stateless: input a11y yaml + field spec + history → exactly one tool call from `click|type|press|waitFor|readValue|done|giveUp`.
System prompt in `prompts/agent_step.md`. AC: FakeProvider test; schema-validate output; reject unknown tools.

**T09 Service /match-option + /runs** — Blocked by: T05.
`/match-option` returns `{index|null, confidence, reason}`; `/runs` + `/runs/{id}/events` persist to a `RunLogSink`
Protocol with `JsonlFileSink` (path from env) as v1. AC: tests; sink never receives document text beyond `quote`.

**T10 Core: config loader + validate-configs** — Blocked by: T02.
`@fib/core/config`: load `configs/forms/<formId>/{extraction,form,widget-profiles}.json` + `configs/templates.json`,
Ajv validation, field-id parity check, profile-reference check, `neverClick` defaults (`Submit|Save|Delete` by role
button name regex). `pnpm validate-configs` CLI. Ship `configs/forms/fixtureDeal/*` matching T14's fixture. AC: bad
configs fail with path-qualified errors; fixture configs pass.

**T11 Core: session reducer** — Blocked by: T02.
Implement `reduce` per §5 and the interface above; illegal transitions throw `IllegalTransition`. AC: table-driven
tests for every legal edge and three illegal ones.

**T12 Core: citation resolver** — Blocked by: T03.
`resolve(set:DocumentSet, result:ExtractionResult): ResolvedField[]`: itemIds → boxes; quote check (normalised
substring, else token-ratio ≥ 0.9); fallback `findPhrase`; status `unverifiedCitation` + confidence `min(c, 0.4)` when
nothing matches; attach `sourceId/sourcePage` from manifest. AC: tests for good ids, bad ids with findable quote, bad
ids with unfindable quote.

**T13 Core: option matcher + planner** — Blocked by: T10.
`matchOption(wanted, options, llm?)`: exact → normalised (case, punctuation, whitespace, "Inc/Incorporated/Ltd"
suffix stripping) → token-set ratio ≥ 0.9 and unique → `llm` callback → null. `buildPlan(formConfig, fields)` per §8:
skip empty values, section order, `navigateTab`/`reveal` steps, grid rows with `addRow` when needed. AC: "Goldman
Sachs" vs ["Goldman Sachs Incorporated","Goldman Sachs Asset Mgmt"] → llm path; planner snapshot test on fixture config.

**T14 Angular fixture form** — Blocked by: T01.
`apps/fixture-form` (Angular 18+, standalone, reactive forms, AG Grid Community): tabs "Deal" and "Parties";
Deal tab: `issuerName` (searchSelect mock: options load after 1500 ms, include "Goldman Sachs Incorporated"),
`dealAmount` text, `currency` select, `settlementDate` date, `isConfidential` checkbox, button "Add fees" reveals
`feeType` select; Parties tab: AG Grid `parties` with columns `partyName` (text editor), `role` (select editor),
`amount` (text), "Add row" button; Submit button (must never be clicked). CSS classes exactly as the profile above.
All inputs have `formControlName`. Read-only `<pre id="model">` shows `form.value` JSON for verification. AC: `pnpm
fixture:serve` on 4300; Playwright smoke test reads `#model`.

**T15 Playwright BrowserDriver** — Blocked by: T14, T02.
`@fib/driver-playwright` implementing `BrowserDriver`; locator precedence formControlName → label → role → css;
`ariaSnapshot` via Playwright `locator.ariaSnapshot()` with ref injection (`[ref=eN]` on interactive nodes);
`waitStable` polls innerText every 100 ms; `setNeverClick`. Tests connect to a Playwright-launched Chromium over CDP
against fixture. AC: all methods covered; NeverClick test clicks Submit and expects throw.

**T16 Basic adapters** — Blocked by: T15.
`text, select, checkbox, date, button, tab` adapters; `write` clears first; `read` returns normalised value. AC:
fixture tests write+read each control, `#model` reflects value (proves Angular registered it).

**T17 searchSelect adapter** — Blocked by: T15, T13.
Per §8: open, type, wait loadingIndicator hidden, `waitStable(optionList, settleMs, maxWaitMs)`, collect options,
`ctx.matchOption`, click option, verify `selectedValue`. Returns `via`. AC: fixture test "Goldman Sachs" resolves
with `via:'fuzzy'` or `'llm'` (fake) and model updates; timeout test with `maxWaitMs:500` fails cleanly.

**T18 agGridCell adapter** — Blocked by: T16.
Row ensure (`addRow` click + wait row count), cell by `col-id`, start edit (double-click), delegate to inner control
adapter, commit Enter, read cell text. AC: fixture test fills 2 rows × 3 cols.

**T19 Executor + retry + verify + events** — Blocked by: T13, T16.
`@fib/fill-engine` Executor per §8 steps 1–3 and 5, emitting `FillEvent`s, `FillReport` summary; `FallbackAgent`
injected (no-op stub here). AC: flaky fake adapter (fails twice) → verified on attempt 3; exhausted → `stepFailed`;
event order snapshot.

**T20 Fallback agent loop** — Blocked by: T19, T15, T06, T08.
`A11yFallbackAgent`: loop ≤ budget: `ariaSnapshot(scope)` → `/agent/step` → execute tool via driver → on `done`
re-verify through adapter `read`. AC: fixture test with a wrong `css` locator for `dealAmount` and a scripted fake
`/agent/step` sequence recovers and verifies; `giveUp` path yields `stepFailed` with reason.

**T21 Electron host shell** — Blocked by: T10, T02.
`apps/desktop`: parse `--dealId=<id> --formId=<id>`, load `templates.json`, open `WebContentsView` at URL, side
panel `WebContentsView` for `@fib/panel`, `remote-debugging-port` on 127.0.0.1 random free port set before ready,
preload `contextBridge` API `window.fib` with typed channels generated from `contracts` (`ipc-channels.ts`),
`HtmlToPdf` impl via hidden `webContents.printToPDF`. AC: `pnpm --filter desktop dev --dealId=1 --formId=fixtureDeal`
opens fixture; `curl 127.0.0.1:<port>/json/version` works; printToPDF unit test.

**T22 Ingest in utility process** — Blocked by: T21, T04.
Run `@fib/ingest` in `utilityProcess.fork`, message protocol `{type:'ingest',paths}` → `{type:'done',documentSet}` /
`{type:'progress',stage}`; merged PDF bytes passed as `ArrayBuffer`; temp files deleted. AC: integration test from main.

**T23 Panel: upload + field list** — Blocked by: T06, T02.
`@fib/panel` React: drop zone, progress, field list with status badges
`verified|filledByAgent|needsReview|lowConfidence|notFound|failed`, attention-first sort, source label "from <name>,
page N". Driven by a `PanelApi` interface (real: `window.fib`; test: in-memory). AC: Vitest + Testing Library.

**T24 Panel: PDF viewer with highlights** — Blocked by: T12, T23.
`pdfjs-dist` page canvas + overlay boxes scaled `viewport.scale` (points→px), jump to `mergedPage` on field click,
pulse animation, document switcher derived from manifest. AC: component test renders `fixtures/simple.pdf` and
positions a box within 1 px of expected.

**T25 Desktop session wiring** — Blocked by: T11, T19, T20, T21, T22, T06.
Main-process `SessionController`: reducer + ingest + api-client + executor + driver; streams state and events to panel
over IPC; run-log client posts start/end/events. AC: e2e on fixture with FakeApiClient: drop synthetic `.msg` →
fields filled → panel shows verified statuses → `#model` matches expected JSON.

**T26 Panel: edit + re-push** — Blocked by: T25, T24.
Inline edit → `userEdit` event → single-step plan → executor → status update. AC: e2e edit `dealAmount`, model updates.

**T27 Eval harness + synthetic goldens** — Blocked by: T07, T03.
`evals/harness` CLI per §11; `evals/synthetic/` generator makes 3 PDFs + expected JSON at build time; report
markdown + JSON. AC: CI runs harness with FakeProvider, accuracy 100 % on synthetic set; `--golden $GOLDEN_DIR` honoured.

**T28 Portable EXE packaging + deploy jobs** — Blocked by: T25.
electron-builder `portable` target, `extraResources: configs/`, native module rebuild for LiteParse if chosen native,
CI job `build-exe` on Windows runner producing artifact; `deploy-service` job building a container image. AC: EXE
artifact launches with `--dealId` on a Windows runner (smoke via `xvfb`-free headless check of the CDP endpoint).

**T29 Full e2e + docs** — Blocked by: T26, T27, T28.
`pnpm e2e` runs fixture + fake service + desktop end to end; `README.md` per package; root `CONTRIBUTING.md` with
the "add a form" and "add a widget adapter" walkthroughs. AC: e2e green in CI; docs reviewed against configs.

### Parallel frontier after T01→T02
Wave A (all independent): T03, T05, T06, T10, T11, T14.  Wave B: T04, T07, T08, T09, T12, T13, T15, T21.
Wave C: T16, T17, T22, T23. Wave D: T18, T19, T24, T27. Wave E: T20, T25. Wave F: T26, T28. Wave G: T29.

---

## Decision log (interview transcript summary)

### Round 1
- Topology: Python FastAPI service deployed independently of the EXE.
- Brains: extraction in Python (server), fill engine in TypeScript inside Electron.
- LLM: OpenAI models via internal, OpenAI-API-compatible gateway (Claude-compatible too). Text only today.
- Forms: internal, SSO, Angular; 20–30 forms/day/user; DOM changes ~monthly; generic later.
- Attach: Playwright over CDP into Electron's own Chromium.
- Inputs: PDF and Outlook .msg (attachments: PDFs, images; inline images with tables). LiteParse locally. Nothing persisted server-side.
- Citations: bounding boxes. Agentic spectrum: config-first + fallback + (later) discovery agent.
- Authoring: devs + BAs write per-field prompts; JSON config; multi-tab forms; configs ship with EXE; no versioning yet.
- Submit: never automated. Grids: add-row and pre-built; cells text or dropdown.
- Audit: dev dump toggle; run log of who/what/when. Platform: Windows, shared-drive EXE, deploy pipeline replaces EXE.
- Stack: TS/React, Electron+Playwright, FastAPI+Pydantic; frameworks allowed but not required.

### Facts found (LiteParse docs)
- Local, Node/Python/Rust/WASM; OCR via Tesseract or external server.
- Per-page `textItems[]` `{text,x,y,width,height}` in PDF points, top-left origin; `searchItems({phrase})` helper.
- Office formats need LibreOffice (irrelevant now: no Office inputs). `.msg` unsupported → separate parser.

### Round 2
- Delivery: Electron + Playwright behind `BrowserDriver`; no browser-use; Stagehand only as a future plugin. React panel.
- Widgets: AG Grid; `formControlName` present. Merged PDF kept, plus page manifest for provenance.
- Extraction: schema-driven structured outputs; prompts as maintainable files. No cross-document reconciliation needed.
- Discovery agent wanted (deferred). Fallback: a11y tree only, latency-aware, semantic option matching with review flag.
- Confidence shown for now. Eval harness on extraction JSON vs goldens. Run log to service. Deal id via CLI arg; one fill at a time; parallel later.

### Round 3
- Parsing stays in the UI (utility process) behind `DocumentIngest`. In-house dropdown → adapter + profile model.
- All LLM calls via the service. URL templates JSON with `{dealId}`. Angular fixture form. Monorepo, one CI, two deploys. v1 scope as in §13.

### Round 4
- Profile approach confirmed; DOM snippets to be supplied during adapter work. Angular fixture confirmed.
- Tooling list accepted (Node 22, current Electron w/ WebContentsView, pnpm, Vite, Python 3.12 + uv, OpenAI SDK, Pydantic v2, JSON Schema contract, Vitest/Playwright/pytest).
- Goldens outside repo; synthetic set in repo; harness reused for model comparison.
