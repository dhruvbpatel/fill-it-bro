# 02: Contracts + codegen

**What to build:** The single source of truth for every JSON shape that crosses a boundary (ingest→core, desktop→service, main→panel), as JSON Schemas, with generated TypeScript types and Pydantic models that cannot drift.

**Blocked by:** 01 (Monorepo scaffold)

**Status:** ready-for-agent

## Read first
- `.scratch/fill-it-bro/PLAN.md` §4 (data contracts), §7 (service endpoints), §15 key interfaces.

## Do exactly this
- Schemas in `packages/contracts/schemas/<name>.schema.json` (draft 2020-12, `$id` = `https://fib.local/schemas/<name>`, `title` = PascalCase name, `additionalProperties: false` everywhere):
  `document-set` (without `mergedPdf`; bytes never go in JSON), `document-source`, `page`, `text-item`, `manifest-entry`,
  `extraction-request`, `extraction-result`, `extracted-field`, `extracted-group`, `citation-ref` (`{itemIds[], quote}`),
  `citation` (`{mergedPage, boxes[{x,y,w,h}], quote, sourceId, sourcePage}`), `resolved-field` (extracted-field + `citations: citation[]` + `status` enum `found|notFound|ambiguous|unverifiedCitation`),
  `form-config`, `extraction-config`, `widget-profiles`, `locator-spec`,
  `fill-plan` (`steps[]` with `kind` enum `navigateTab|reveal|fillField|addRow|fillCell`), `fill-step`, `fill-event` (enum `stepStarted|stepVerified|stepRetrying|stepFallback|stepFailed|stepSkipped`), `fill-report`,
  `agent-step-request` (`{goal, fieldSpec, a11ySnapshot, history[]}`), `agent-step-response` (oneOf tool calls `click|type|press|waitFor|readValue|done|giveUp`),
  `match-option-request` (`{wanted, options[]}`), `match-option-response` (`{index: int|null, confidence, reason}`),
  `run-log-event` (`{runId, ts, user, kind, payload}`).
- `packages/contracts/examples/<name>.json`: one valid example per schema.
- `packages/contracts/scripts/gen.ts`: runs `json-schema-to-typescript` for all schemas into `packages/contracts/src/generated/` and exports them from `src/index.ts`; then runs `datamodel-codegen` (python `datamodel-code-generator`, pydantic v2 output) into `apps/service/src/fib_service/contracts/`. Wire root `pnpm contracts:gen`.
- Commit generated output. Add CI step: run gen, `git diff --exit-code`.
- Tests: TS (Vitest + Ajv) validates every example against its schema; Python (pytest) loads every example into its model and dumps back equal JSON.

## Acceptance criteria
- [ ] Every schema has an example and both round-trip tests pass.
- [ ] `pnpm contracts:gen` is idempotent (second run produces no diff).
- [ ] `ExtractedField` has `status` enum `found|notFound|ambiguous` and `confidence` number 0..1; `ResolvedField` adds `unverifiedCitation`.
- [ ] `LocatorSpec` matches §15 exactly (`formControlName?`, `label?`, `role?{name,role}`, `css?`, `within?`, `nth?`).
