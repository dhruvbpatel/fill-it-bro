# fib_service

The Python service (FastAPI): everything that needs an LLM or a durable sink, so no
gateway credential ever ships inside the EXE. Stateless between requests; documents
are never persisted — only text items, a11y snapshots, option lists and quotes arrive.

## Endpoints

- `GET /healthz`
- `POST /extract` — per source document: compiles `configs/forms/<formId>/extraction.json`
  (BA prompts from `prompts/<fieldId>.md` override inline descriptions) into a strict
  JSON schema whose property descriptions are the field prompts, formats page text as
  `[p3i17] text` lines, and forces `{ value, itemIds, quote, confidence, reason }` per
  field. Groups (grids) extract as arrays of row objects. Output validated against the
  `extraction-result` contract. `DUMP_EXTRACTION_DIR` mirrors requests/results to disk.
- `POST /agent/step` — stateless fallback step: a11y yaml + field spec + history in,
  exactly one tool call out (`click|type|press|waitFor|readValue|done|giveUp`); unknown
  tools are rejected. System prompt: `prompts/agent_step.md`.
- `POST /match-option` — `{ wanted, options[] }` → `{ index|null, confidence, reason }`.
- `POST /runs`, `POST /runs/{id}/events` — run-log sink (`RunLogSink` protocol,
  `JsonlFileSink` at `RUN_LOG_PATH`).

## Providers

`LLMProvider` protocol (`structured`, `tool_step`). `OpenAIProvider` uses the Responses
API with `text.format=json_schema` against the gateway (`GATEWAY_BASE_URL`,
`GATEWAY_API_KEY`, `MODEL`), falling back to chat-completions JSON mode on 4xx.
`FakeProvider` returns canned JSON from test fixtures. Selection: `PROVIDER=openai|fake`.

## Run

```
uv run fib-service          # PORT env, default 8787
```

## How to test

```
uv run pytest               # repo root: apps/service + evals/harness
uv run ruff check apps/service evals/harness
```

Tests run against `FakeProvider`; contract tests check the generated Pydantic models
round-trip the JSON Schemas' examples.
