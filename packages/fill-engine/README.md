# @fib/fill-engine

The fill loop for the Electron main process: planner output in, verified fields out.

## Public API

- `Executor` — runs a `FillPlan` step by step:
  1. `adapter = registry.get(step.control)` + the step's widget profile.
  2. Attempt loop (`RetryPolicy`, default `DEFAULT_RETRY = { attempts: 3, backoffMs: [300, 800, 1500] }`):
     `write` → `read` → `valuesEqual` compare; success emits `stepVerified`.
  3. Mismatch/timeout → retry with backoff (idempotent: adapters clear first).
  4. Retries exhausted → the injected `FallbackAgent` runs within its budget.
  5. Anything matching `neverClick` aborts the run before the click.
     Emits `FillEvent`s through the `onEvent` callback and returns a `FillReport`.
- `A11yFallbackAgent` — the v1 fallback: `ariaSnapshot` of the step's region →
  `/agent/step` tool call (via the injected api client) → execute through the driver →
  re-verify; `done` → `filledByAgent`, `giveUp` → `stepFailed(reason)`.
- `NoopFallbackAgent` — test stub that always gives up.
- Types: `RetryPolicy`, `FallbackAgent`, `FallbackBudget`, `FillReport`, `StepStatus`,
  `VerifiedVia`.

## How to test

```
pnpm --filter @fib/fill-engine test
```

Vitest unit tests (flaky fake adapters, retry/backoff, event order snapshots) plus
Playwright specs against the fixture form (`webServer` on `FIXTURE_PORT`, default 4300).
