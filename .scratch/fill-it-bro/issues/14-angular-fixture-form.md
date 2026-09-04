# 14: Angular fixture form

**What to build:** A deliberately awkward Angular form that reproduces every real-world scenario (tabs, reveal button, slow searchable dropdown with non-exact names, AG Grid with add-row, a Submit that must never be clicked) and exposes its reactive form model as JSON so tests can prove Angular really registered each value.

**Blocked by:** 01 (Monorepo scaffold)

**Status:** ready-for-agent

## Read first
- PLAN.md §15 widget profile (CSS class names are a contract), ticket 10 field ids.

## Do exactly this
- `apps/fixture-form`: Angular 18+ standalone app, route `/deal/:dealId`, `ag-grid-angular` + `ag-grid-community`. Serve on port 4300 via root `pnpm fixture:serve`. CI job `fixture` builds it.
- Tabs (role `tab`, names "Deal" and "Parties") switching two `<section>`s; only the active section is in the DOM.
- Deal tab reactive form, all controls with `formControlName`: `issuerName` (custom `FibSearchSelectComponent`, see below), `dealAmount` (`<input type=text>`), `currency` (`<select>` USD/EUR/GBP), `settlementDate` (`<input type=date>`), `isConfidential` (checkbox), button "Add fees" (role button) that reveals `feeType` (`<select>` Fixed/Variable) which is absent from the DOM until clicked.
- `FibSearchSelectComponent` (ControlValueAccessor): trigger `.fib-select__trigger` opens a panel; search input `.fib-select__search`; while typing shows `.fib-select__loading` for 1500 ms then renders `.fib-select__options` with `.fib-select__option` items filtered from `['Goldman Sachs Incorporated','Goldman Sachs Asset Management','Morgan Stanley & Co','JPMorgan Chase Bank']`; clicking sets `.fib-select__value` text and the form value; options re-render (flicker) once 200 ms after first render to simulate the race.
- Parties tab: AG Grid `data-testid="parties-grid"`, columns `partyName` (`agTextCellEditor`), `role` (`agSelectCellEditor` Issuer/Agent/Guarantor), `amount` (`agTextCellEditor`), starts with 1 empty row; button "Add row" appends a row; grid rows sync to a `FormArray` `parties`.
- Submit button (role button, name "Submit") that sets `window.__submitted = true` (tests assert it stays undefined).
- `<pre id="model">` re-rendered on every `valueChanges` with `JSON.stringify(form.value)`.
- Playwright smoke test `apps/fixture-form/e2e/smoke.spec.ts`: load, type into `dealAmount`, read `#model`.

## Acceptance criteria
- [ ] `pnpm fixture:serve` serves `/deal/1` on 4300.
- [ ] Smoke test passes.
- [ ] Typing "Goldman" in the searchSelect shows the loading indicator for ≥1.4 s then 2 options.
- [ ] `feeType` is absent until "Add fees" is clicked.
