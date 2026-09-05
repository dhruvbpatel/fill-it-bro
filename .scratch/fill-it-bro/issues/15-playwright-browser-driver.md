# 15: Playwright BrowserDriver

**What to build:** The only code that touches the browser: a `BrowserDriver` implementation on Playwright that connects over CDP, resolves locator specs by a fixed precedence, snapshots the accessibility tree with usable refs, waits for a region to stop changing, and refuses to click Submit-like buttons.

**Blocked by:** 14 (Angular fixture form), 02 (Contracts + codegen)

**Status:** done (t15 branch)

## Read first
- PLAN.md §15 `BrowserDriver` interface (final), §8 BrowserDriver paragraph.

## Do exactly this
- Interface file `packages/core/src/driver.ts` (copy verbatim from PLAN §15, plus `export class NeverClickError extends Error`).
- `packages/driver-playwright/src/PlaywrightDriver.ts`: `connect(cdpUrl, pageUrl)` → `chromium.connectOverCDP(cdpUrl)`, pick the first page whose URL matches `pageUrl`, else wait up to 10 s for one.
- `resolve(spec)`: precedence `formControlName` (`[formcontrolname="x"]`, case-insensitive attribute) → `label` (`getByLabel`) → `role` (`getByRole(role, { name })`, name may be a `/regex/flags` string) → `css`; apply `within` (resolve parent first, then `.locator`) and `nth`. `Ref` → element stored from the last `ariaSnapshot`.
- `ariaSnapshot(scope)`: call Playwright `ariaSnapshot()` on scope (default `body`); then enumerate interactive elements in scope (`button, a, input, select, textarea, [role=option], [role=tab], [role=gridcell], [contenteditable]`), assign `e1..eN`, store `ElementHandle`s, and append ` [ref=eN]` to the matching snapshot line by matching role+name; return `{ yaml, refs }`.
- `waitStable(spec, settleMs, maxMs)`: poll `innerText` every 100 ms; resolve when unchanged for `settleMs`; reject `StableTimeout` after `maxMs`.
- `setNeverClick(patterns)`: before every `click`, resolve each pattern and compare element handles (`evaluateHandle` identity); match → throw `NeverClickError`.
- `readValue`: `inputValue()` for input/select/textarea; `checkbox` → `'true'|'false'`; else `innerText`.
- Tests launch Chromium with `--remote-debugging-port=0`, read the port, `connect`, against the fixture on 4300 (start it in a Playwright `webServer`).

## Acceptance criteria
- [x] Every interface method has at least one test against the fixture.
- [x] `ariaSnapshot()` yaml contains `[ref=` for the Submit button and the refs array is non-empty.
- [x] `setNeverClick([{role:{role:'button',name:'/^submit$/i'}}])` then `click({role:{role:'button',name:'Submit'}})` throws `NeverClickError` and `window.__submitted` stays undefined.
- [x] `waitStable` on the option list resolves after the fixture's flicker and rejects with `maxMs: 300`.
