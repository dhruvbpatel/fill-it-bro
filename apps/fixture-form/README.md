# apps/fixture-form

A deliberately awkward Angular 18 form used as the test fixture for the browser-automation
pipeline: tabs, a reveal button, a slow non-exact search dropdown, an AG Grid with add-row, and
a Submit button that must never be clicked.

## Serve

```
pnpm fixture:serve
```

Serves `/deal/:dealId` on port `4300` by default. Override with `FIXTURE_PORT`:

```
FIXTURE_PORT=4321 pnpm fixture:serve
```

Every Playwright `webServer` and test URL (here and in later tickets) reads this same
`FIXTURE_PORT` variable, so the port stays consistent everywhere.

## Test

```
pnpm --filter fixture-form exec playwright install --with-deps chromium   # once
pnpm --filter fixture-form test
```

## Contract note

`.fib-select__*` CSS classes, the `data-testid="parties-grid"` attribute, ARIA roles/names
("Deal"/"Parties" tabs, "Add fees", "Add row", "Submit"), and every `formControlName` are load
-bearing: they are referenced directly by `PLAN.md §15` (widget profile) and ticket 10 (config
loader field ids) and driven by later tickets' Playwright driver and widget adapters. Don't
rename them without updating those contracts too.
