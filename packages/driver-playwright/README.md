# @fib/driver-playwright

The v1 `BrowserDriver` implementation: Playwright over CDP into the desktop's own
Chromium (Electron `remote-debugging-port`).

## Public API

- `PlaywrightDriver` — implements `@fib/core`'s `BrowserDriver`:
  - `connect(cdpUrl, pageUrlRegex)` — `connectOverCDP`, binds to the page whose URL
    matches the deal form; refuses pages outside the form origin.
  - Locators from a `LocatorSpec` with precedence `formControlName → label → role → css`,
    optionally `within` a parent spec / `nth`.
  - `click/type/fill/selectByLabel/press/readValue/readText/count/waitFor/waitStable`.
  - `waitStable(spec, settleMs, maxMs)` — polls `innerText` every 100 ms until unchanged
    for `settleMs` (the dropdown race fix); throws `StableTimeout` past `maxMs`.
  - `ariaSnapshot(scope?)` — Playwright's snapshot with `[ref=eN]` injection; the refs
    are usable as `{ ref }` targets.
  - `setNeverClick(patterns)` — `click()` throws `NeverClickError` when the target
    matches a protected locator (Submit/Save/Delete defaults come from the config loader).
- Re-exports `NeverClickError` and the `BrowserDriver`/`LocatorSpec`/`Ref` types.

## How to test

```
pnpm --filter @fib/driver-playwright test
```

Playwright specs in `tests/` launch headless Chromium over CDP against the fixture form
(the config's `webServer` starts it on `FIXTURE_PORT`, default 4300) and cover every
method, including the NeverClick guard.
