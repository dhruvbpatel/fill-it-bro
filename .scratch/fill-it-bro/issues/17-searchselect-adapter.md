# 17: searchSelect adapter

**What to build:** The adapter that fixes the async searchable-dropdown race: open, type, wait for the option list to finish loading and stop changing, pick the semantically matching option, and verify the displayed value.

**Blocked by:** 15 (Playwright BrowserDriver), 13 (Core: option matcher + planner)

**Status:** ready-for-agent

## Read first
- PLAN.md §8 "searchSelect adapter", §15 widget profile keys.

## Do exactly this
- `packages/adapters/src/searchSelect.ts`, profile required (throw `ProfileRequired` if absent). All profile locators are resolved `within` the field's `target`.
- `write`: click `trigger` → `type(searchInput, value, {clear:true})` → `waitFor(loadingIndicator, 'hidden', profile.maxWaitMs)` (ignore if the indicator never appeared within 200 ms) → `waitStable(optionList, profile.settleMs, profile.maxWaitMs)` → `options()` = `optionItem` texts → `ctx.matchOption(value, options)` → index null: press `Escape`, throw `NoMatchingOption(value, options)`; else click `optionItem` `nth: index` → `waitFor(selectedValue, 'visible', 2000)` → return `{ via }`.
- `read`: `readText(selectedValue)` or null if absent.
- `StableTimeout` from the driver propagates as `OptionsNotSettled`.

## Acceptance criteria
- [ ] Fixture: writing "Goldman Sachs" with a ctx whose `matchOption` uses core `matchOption` plus a fake llm returning index 0 ends with `selectedValue` "Goldman Sachs Incorporated", `#model.issuerName` equal, and `via` ∈ {`fuzzy`,`llm`}.
- [ ] Writing "Morgan Stanley & Co" returns `via: 'exact'`.
- [ ] Profile `maxWaitMs: 500` → rejects `OptionsNotSettled` and the panel is closed (Escape pressed).
- [ ] Writing "Nonexistent Bank" → `NoMatchingOption`.
