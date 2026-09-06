# @fib/api-client

Typed `fetch` wrappers for the Python service, plus a fake for tests and local runs.

## Public API

- `ApiClient` — the interface the desktop depends on: `extract`, `agentStep`,
  `matchOption`, `startRun`, `logEvent`. Payloads are the generated `@fib/contracts`
  types; HTTP errors are mapped to typed errors (status + detail, network failures
  included).
- `HttpApiClient` — the real client (`FIB_SERVICE_URL`, default `http://localhost:8787`).
- `FakeApiClient` — in-memory implementation serving canned JSON from `fixtures/`
  (`extract.json`, `agent-step.json`, `match-option.json`), overridable with a
  directory via `FIB_FAKE_FIXTURES_DIR`. Records every call in `calls` so tests can
  assert on them; `queueAgentSteps` scripts the fallback-agent loop.

## How to test

```
pnpm --filter @fib/api-client test
```
