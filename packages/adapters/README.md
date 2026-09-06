# @fib/adapters

The `WidgetAdapter` registry: one adapter per control kind, plus the widget-profile
types that parameterise them. The executor picks an adapter per fill step
(`registry.get(step.control)`) and a profile by name from the form's
`widget-profiles.json`.

## Public API

- `registry` — `Map<control, WidgetAdapter>` with the built-ins pre-registered:
  `text`, `select`, `searchSelect`, `checkbox`, `date`, `button`, `tab`, `agGridCell`.
- `WidgetAdapter` / `AdapterCtx` / `WidgetProfile` — the seam types (`control`,
  `write`, `read`, optional `options`); adapters are idempotent (they clear before
  writing) so executor retries are safe.
- `searchSelectAdapter` — opens via the profile trigger, types, waits for the loading
  indicator to disappear and the option list to settle (`settleMs`/`maxWaitMs`), then
  picks via `ctx.matchOption` (exact → fuzzy → LLM) and verifies the selected value.
  Throws `OptionsNotSettled` / `NoMatchingOption` / `ProfileRequired`.
- `agGridCellAdapter` + `ensureRow` — row ensure (addRow click + row-count wait), cell
  by `col-id`, double-click to edit, delegate to the inner control, commit with Enter.
- `valuesEqual` — control-aware comparison (trim, number/date normalisation).
- `normaliseDate`, and the individual adapters for direct use/testing.

## How to test

```
pnpm --filter @fib/adapters test
```

Vitest unit tests plus Playwright specs against the fixture form (`webServer` starts it
on `FIXTURE_PORT`, default 4300): every control is written and read back, including the
delayed non-exact searchSelect and the AG Grid.
