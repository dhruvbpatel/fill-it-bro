# 16: Basic adapters

**What to build:** Widget adapters for text, select, checkbox, date, button and tab that write a value, then read it back, and are proven against the Angular fixture by checking the form model actually changed.

**Blocked by:** 15 (Playwright BrowserDriver)

**Status:** ready-for-agent

## Read first
- PLAN.md §15 `WidgetAdapter`, `AdapterCtx`, `registry` (final).

## Do exactly this
- `packages/adapters/src/adapter.ts` with the interfaces and `registry` (a `Map` populated at import by `packages/adapters/src/index.ts`).
- `text`: `click` → `type(value, {clear:true})` → `press('Tab')`; `read` = `readValue`.
- `select`: `options()` = option texts; `write` picks by `ctx.matchOption`; use Playwright `selectOption` via a driver extension `selectByLabel(spec, label)` (add to `BrowserDriver` in this ticket, update the interface file and PLAN §15 note "added by ticket 16"); `read` = selected option text.
- `checkbox`: value parsed `true|yes|1` → checked; `read` returns `'true'|'false'`.
- `date`: normalise input to `YYYY-MM-DD` (accept `DD/MM/YYYY`, `MM/DD/YYYY` per `profile.dateFormat` default ISO, `D Month YYYY`); `type` then `Tab`; `read` = `readValue`.
- `button`: `write` = click (value ignored); `read` = null.
- `tab`: `write` = click the tab then `waitFor(target, 'visible', 2000)`; `read` = null.
- Normalised equality helper `valuesEqual(control, a, b)` in `packages/adapters/src/equality.ts` (numbers: strip `,` and currency symbols; dates: ISO compare; strings: trim + collapse spaces + case-insensitive).

## Acceptance criteria
- [ ] Fixture tests: each adapter writes then reads its value and `#model` JSON contains the value (proves Angular registered the change).
- [ ] `select` with "usd" matches "USD" via normalised tier.
- [ ] `date` with "30/09/2026" and `dateFormat: 'DD/MM/YYYY'` reads back `2026-09-30`.
