# 19: Executor + retry + verify + events

**What to build:** The engine that runs a fill plan step by step: pick the adapter, write, read back, compare, retry with backoff, hand off to a fallback agent when retries are exhausted, stream an event for every state change, and never touch Submit.

**Blocked by:** 13 (Core: option matcher + planner), 16 (Basic adapters)

**Status:** ready-for-agent

## Read first
- PLAN.md §8 Executor steps 1–5, §15 `RetryPolicy`, `FallbackAgent`, `Executor` (final).

## Do exactly this
- `packages/fill-engine/src/Executor.ts`: `new Executor({ driver, registry, matchOption, fallback: FallbackAgent, retry?: RetryPolicy, neverClick: LocatorSpec[], profiles })`. On `run(plan, onEvent)`: `driver.setNeverClick(neverClick)` first.
- Per step kind: `navigateTab` → tab adapter; `reveal` → button adapter; `addRow` → `ensureRow`; `fillField`/`fillCell` → attempt loop.
- Attempt loop: for attempt 1..`retry.attempts`: emit `stepStarted` (attempt 1 only) → `adapter.write` → `adapter.read` → `valuesEqual(control, value, read)` → emit `stepVerified { via }` and continue to next step; on throw or mismatch emit `stepRetrying { attempt, reason }` and sleep `backoffMs[attempt-1]`. After the loop: emit `stepFallback`, call `fallback.run(step, ctx, { attempts: 3, timeoutMs: 20000 })`; `ok` → `adapter.read` again, equal → `stepVerified { via: 'agent' }`, else `stepFailed { reason: 'agent reported done but value mismatch' }`; `!ok` → `stepFailed { reason }`.
- Steps flagged `skip` emit `stepSkipped { reason }`.
- `NeverClickError` anywhere → emit `stepFailed` and abort the whole run with `FillReport.aborted = true`.
- `FillReport`: counts per outcome + per-step outcomes + duration. Extend `fill-event` schema with `via` enum `exact|fuzzy|llm|agent` and regen contracts.
- Ship `NoopFallbackAgent` returning `{ ok: false, reason: 'no fallback configured' }`.

## Acceptance criteria
- [ ] Unit test with an in-memory fake driver/adapter that fails twice then succeeds → events `stepStarted, stepRetrying×2, stepVerified`.
- [ ] Adapter always failing + Noop fallback → `stepFallback, stepFailed`, run continues to the next step.
- [ ] Fake adapter throwing `NeverClickError` → report `aborted: true`, no further steps executed.
- [ ] Event sequence snapshot for the fixture plan from ticket 13.
