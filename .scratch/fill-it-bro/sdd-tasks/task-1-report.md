# Task 1 Report: searchSelect panel hygiene (fill stall fix)

## What I implemented

Root cause (confirmed in `apps/fixture-form/src/app/deal-page/deal-page.component.html`): each
field is wrapped in a `<label>`, and label click forwarding re-dispatches the option click to the
trigger button. The widget (`fib-search-select.component.ts`) has no Escape handler; it closes
only via `selectOption` (which `open.set(false)`) or `togglePanel`. So the label-forwarded option
click toggles the panel right back open after the pick, and the open panel blocks the next
field's clicks (~113s stall, runs.jsonl run 7c36c061).

Fix in `packages/adapters/src/searchSelect.ts`:

- New `closePanelBestEffort(ctx, p)` helper: if the option list is still attached
  (`count(optionList) > 0`), re-click the trigger to toggle the panel shut. All failures
  (including the `count` probe) are caught, logged via `ctx.log('searchSelect: panel close
  attempt failed (...)')`, and swallowed — the helper can never mask the pick result or the
  original error.
- Success path: after `waitFor(selectedValue, 'visible')`, call the helper. A close failure is
  logged, never thrown — the pick already succeeded and verify reads `selectedValue`.
- Error paths: both throw sites (`OptionsNotSettled` via `StableTimeout` mapping, and
  `NoMatchingOption`) now call the helper before throwing, preserving the original error. The
  no-op `press(searchInput, 'Escape')` calls are gone.

Profile structure untouched (locators still resolve `within` target), no new profile keys, no
fixture-form changes.

## TDD evidence

### RED

Command: `pnpm --filter @fib/adapters exec vitest run src/searchSelect.test.ts`

Result: `Tests  4 failed | 7 passed (11)` — exactly the new/updated panel-hygiene tests failed,
each for the expected reason (implementation still did the old thing):

- `maps driver StableTimeout ... closes the panel with a trigger click` — expected
  `click issuerName>.fib-select__trigger`, received `press issuerName>.fib-select__search Escape`
- `clicks the trigger to close the panel and still throws NoMatchingOption` — same Escape vs
  trigger-click mismatch
- `re-clicks the trigger after a successful pick when the label reopens the panel` — the two
  trailing actions (`click issuerName>.fib-select__trigger`) were missing from the recorded calls
- `still throws NoMatchingOption when the trigger close attempt itself fails` — no close attempt
  was made and no `close attempt failed` log was emitted

The 7 untouched existing tests kept passing throughout RED, proving the fakes' shape stayed
compatible (brief req 4c).

### GREEN

Same command after implementing: `Tests  12 passed (12)`, clean output, ~80ms.

(After the self-review refactor, final state is `Tests  24 passed (24)` across 4 test files.)

## Files changed

- `packages/adapters/src/searchSelect.ts` — `closePanelBestEffort` helper + three call sites;
  removed the two no-op Escape presses. (+21/−? in final diff)
- `packages/adapters/src/searchSelect.test.ts` — fake driver models the panel
  (`panelOpen` toggled by trigger clicks; option clicks close it, or re-open it when
  `labelForwarding` is set, modeling the `<label>` forwarding; `count(optionList)` reflects
  `panelOpen`); 5 new tests; 2 pre-existing Escape-path tests updated to the redefined
  behavior (same scenarios: `OptionsNotSettled` mapping and `NoMatchingOption` propagation).

## Test commands run and results

| Command | Result |
| --- | --- |
| `pnpm --filter @fib/adapters exec vitest run src/searchSelect.test.ts` | RED: 4 failed / 7 passed → GREEN: 12/12 → after refactor: 12/12 |
| `pnpm --filter @fib/adapters exec vitest run` | 4 files, 24/24 passed |
| `pnpm --filter @fib/adapters exec tsc -p tsconfig.json --noEmit` | clean |
| `env -u ELECTRON_RUN_AS_NODE pnpm --filter @fib/adapters test` (sandboxed, then unsandboxed) | all 16 Playwright tests failed with `spawn .../Google Chrome for Testing ENOENT` — no test executed |
| `env -u ELECTRON_RUN_AS_NODE -u PLAYWRIGHT_BROWSERS_PATH pnpm --filter @fib/adapters test` | **16/16 passed (26.2s)**, including all 4 `searchSelect.spec.ts` e2e scenarios against the fixture form |

### Environment note (in addition to the brief's ELECTRON_RUN_AS_NODE)

`env -u ELECTRON_RUN_AS_NODE` was **not sufficient** here. This shell also exports
`PLAYWRIGHT_BROWSERS_PATH=/var/folders/.../cursor-sandbox-cache/<hash>/playwright`, and that
directory is **empty**, so Playwright could not find `chromium-1234` and every test failed at
browser spawn (`ENOENT`) — independent of `ELECTRON_RUN_AS_NODE` (it failed the same way
unsandboxed). The real browsers live in `~/Library/Caches/ms-playwright`, so the working
invocation was:

```
env -u ELECTRON_RUN_AS_NODE -u PLAYWRIGHT_BROWSERS_PATH pnpm --filter @fib/adapters test
```

Worth folding into the orchestration run-ticket script if other tasks hit the same wall.

## Self-review findings

1. **Fake-driver substring bug (caught + fixed pre-commit):** `.fib-select__options` contains the
   substring `.fib-select__option`; my first `count()` dispatch checked the option-item branch
   first, so the adapter's `count(optionList)` probe returned the *option* count. The suite went
   green for the wrong reason (the guard saw a non-zero count and always re-clicked, which
   silently broke the "does not re-click when already closed" test). Fixed by testing the
   `__options` branch first, with an explanatory comment.
2. **Duplication (caught in checklist review + fixed):** the first implementation inlined a
   try/catch+log wrapper at all three call sites — exactly what the checklist warns about.
   Folded the swallow-and-log into `closePanelBestEffort` itself; call sites are now one line
   each. Amended into the single Task 1 commit after re-running the full suite (24/24 vitest +
   16/16 Playwright).
3. **Coverage:** success-path re-click, success-path no-op when already closed, success-path
   close-failure tolerance (log, no throw), `OptionsNotSettled` + trigger close,
   `NoMatchingOption` + trigger close + propagation, `NoMatchingOption` + close-failure
   propagation. Behavior asserted through recorded driver calls and the fake's panel state, not
   implementation internals.
4. **Pre-existing test edits:** two tests were retitled/re-specified because this ticket
   redefines the close behavior they assert (Escape → trigger click); what they verify
   (error-type mapping and error propagation) is preserved verbatim.

## Concerns

- None functional. The only surprise was environmental (`PLAYWRIGHT_BROWSERS_PATH`), documented
  above. Note the success-path close relies on `count(optionList)`; on the real page the panel
  detaches on close, so the guard keeps the no-op case click-free, and a genuine stuck-open
  panel gets exactly one toggle click.
