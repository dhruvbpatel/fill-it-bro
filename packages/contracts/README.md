# @fib/contracts

The single source of truth for every JSON shape crossing a process boundary:
panel ⇄ Electron main, desktop ⇄ Python service, configs ⇄ loaders.

## What's here

- `schemas/*.schema.json` — 25 hand-authored JSON Schema (draft 2020-12) documents:
  `document-set`, `extraction-request`, `extraction-result`, `resolved-field`, `citation`,
  `form-config`, `extraction-config`, `widget-profiles`, `fill-plan`, `fill-event`,
  `fill-report`, `agent-step-request/response`, `match-option-request/response`,
  `run-log-event`, plus shared defs (`locator-spec`, `box`, …). Each has a matching
  `examples/*.json` fixture.
- `src/generated/` — TypeScript types generated from the schemas. **Never hand-edit**;
  change the schema and regenerate.
- `src/ipc-channels.ts` — the typed IPC channel names used between panel and main.

## Codegen

```
pnpm contracts:gen
```

regenerates both consumers and must produce a clean diff (CI fails on drift):

- `json-schema-to-typescript` → `packages/contracts/src/generated/`
- `datamodel-code-generator` → `apps/service/src/fib_service/contracts/` (Pydantic v2)

## How to test

```
pnpm --filter @fib/contracts test
```

Round-trip tests validate every `examples/*.json` fixture against its schema with Ajv,
and (on the Python side, run via `uv run pytest`) assert the generated Pydantic models
accept the same fixtures.
