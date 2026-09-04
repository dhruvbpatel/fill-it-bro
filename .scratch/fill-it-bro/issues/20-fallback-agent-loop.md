# 20: Fallback agent loop

**What to build:** When deterministic filling fails, an agent loop that looks at the accessibility tree, asks the service for one action at a time, performs it, and stops when the field verifiably holds the value or the budget is spent.

**Blocked by:** 19 (Executor), 15 (Playwright BrowserDriver), 06 (TS api-client + fake), 08 (Service /agent/step)

**Status:** ready-for-agent

## Do exactly this
- `packages/fill-engine/src/A11yFallbackAgent.ts` implementing `FallbackAgent`, constructed with `{ api: ApiClient, scope?: LocatorSpec }`.
- Loop while `actions < budget.attempts * 4` and elapsed < `budget.timeoutMs`: `snap = driver.ariaSnapshot(scope)` → `res = api.agentStep({ goal: 'Set field <fieldId> to <value>', fieldSpec: { fieldId, control, label: step.label ?? fieldId, value }, a11ySnapshot: snap.yaml, history })` → execute: `click` → `driver.click({ref})`; `type` → `driver.type({ref}, text, {clear:true})`; `press` → `driver.press({ref}, key)`; `waitFor` → `driver.waitFor(...)`; `readValue` → push result to history; `done` → return `{ ok: true, value }`; `giveUp` → return `{ ok: false, reason }`. Unknown ref → push error to history and continue. Push every action + outcome to `history`.
- Budget exhausted → `{ ok: false, reason: 'budget exhausted' }`.
- Log each action through `ctx.log`.

## Acceptance criteria
- [ ] Fixture test: plan step for `dealAmount` with a wrong `css` locator; `FakeApiClient.queueAgentSteps([type e?, press Enter, readValue, done])` where the test resolves the real ref for the input from a snapshot → executor emits `stepFallback` then `stepVerified { via: 'agent' }` and `#model.dealAmount` matches.
- [ ] Queue `[giveUp]` → `stepFailed` with the given reason.
- [ ] `budget.timeoutMs: 1` → `budget exhausted`.
