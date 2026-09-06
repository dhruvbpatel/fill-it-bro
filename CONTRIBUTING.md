# Contributing

Setup: Node 22 + pnpm 9, Python 3.12 + uv. `pnpm install` once (it also rebuilds the
LiteParse native module against Electron), then `pnpm build && pnpm test && pnpm lint`
and `uv run pytest` should all be green.

House rules: TypeScript strict, ESM, no `any`; Python formatted/linted with ruff.
Contracts (`packages/contracts/schemas/*.schema.json`) are the source of truth for
anything crossing a process boundary — change the schema, run `pnpm contracts:gen`,
commit the regenerated output.

Two walkthroughs below: **add a form** (BA + dev) and **add a widget adapter** (dev).

---

## Add a form

Everything a form needs lives in `configs/forms/<formId>/`. The `fixtureDeal` set
drives the Angular fixture app and is the reference to copy. This walkthrough adds a
copy under a new id; `pnpm validate-configs` is the checkpoint at the end.

### 1. Create the config directory

```
cp -r configs/forms/fixtureDeal configs/forms/acmeDeal
```

Three files matter (prompts are optional):

- `extraction.json` — **what to extract** (BA-authored)
- `form.json` — **how to fill it** (dev-authored)
- `widget-profiles.json` — DOM hooks for non-trivial widgets
- `prompts/<fieldId>.md` — optional long-form prompt per field

### 2. Write the extraction fields and prompts

In `extraction.json`, set `formId` to your id and edit `fields` (one entry per scalar
form field):

- `fieldId` — camelCase; must match `form.json` exactly (the loader checks parity).
- `type` — `string | number | date | boolean`; `enum` constrains the value.
- `description` — the prompt the LLM sees for this field. Write it like you'd brief a
  person: what the value is, format, and what to do when it's absent.
- `required`, `examples` — required is a schema flag; examples teach the format.

Long-form prompt? Put it in `prompts/<fieldId>.md` — the service overrides the inline
description with the file's contents when the file exists.

Grids (AG Grid) get a `groups` entry: `groupId`, a `description`, and the per-column
field defs.

### 3. Write the `form.json` sections

`form.json` mirrors how a human fills the form: ordered `sections`, each with optional
`tab` (click to navigate) and `reveal` (click to expose hidden fields), then `fields`
and `grids`.

- Set `formId` and `urlTemplate` (the `{dealId}` placeholder is replaced at launch).
- Each field: `fieldId` (as in extraction.json), `control` (`text`, `select`,
  `searchSelect`, `date`, `checkbox`, …), and a `locator` — prefer
  `{"formControlName": "..."}` (Angular), else `label` / `role` / `css`.
- Fields using a custom widget name a `profile` that must exist in
  `widget-profiles.json` (the loader checks).
- Each grid: `groupId` (matches the extraction group), `control: "agGrid"`, the grid
  `locator`, `addRow` locator, and `columns` mapping `fieldId → colId` + inner control.

Add a matching entry to `configs/templates.json` — the launcher resolves the form URL
from there:

```
"acmeDeal": { "urlTemplate": "https://forms.example.com/acme/{dealId}" }
```

(`loadFormBundle` takes the runtime URL from `templates.json`; keep `form.json`'s
`urlTemplate` in sync — the schema requires the key.)

### 4. Validate

```
pnpm validate-configs
```

This loads every form bundle with the same code the desktop uses: Ajv validation
against the contracts schemas, field-id parity between the two files, profile
references, grid/group parity. Failures print the file and JSON-pointer path.

### 5. Add a golden case

Prove extraction quality on a known document. A golden case is a directory:

```
evals/synthetic/cases/acmeDeal/my-case/
  documentSet.json   # DocumentSet contract shape: pages[].items with ids + boxes
  expected.json      # { "fields": { "<fieldId>": <value>, ... }, "groups": { ... } }
```

Get `documentSet.json` by running a real (or synthetic) PDF through
`packages/ingest/scripts/ingest-cli.ts`. To run the harness with `--provider fake`,
also drop the canned LLM response the fake should serve:
`apps/service/tests/fixtures/acmeDeal_main__my-case.json` (+ `acmeDeal_<group>__my-case.json`
per group), keyed by the compiled schema title (`<formId>_main`, `<formId>_<group>`)
with `itemIds` valid for your documentSet. Then:

```
uv run evals --forms configs/forms --golden evals/synthetic/cases --provider fake --min-accuracy 1.0
```

(For `fixtureDeal` the committed synthetic set is regenerated with `uv run evals-synth`.)

---

## Add a widget adapter

Widget adapters turn "set this field to this value" into browser actions for one
control kind. The seam is `WidgetAdapter` in `packages/adapters/src/adapter.ts`.

### 1. Implement `WidgetAdapter`

Create `packages/adapters/src/myWidget.ts`:

```ts
import type { WidgetAdapter } from './adapter.js';

export const myWidgetAdapter: WidgetAdapter = {
  control: 'myWidget',

  async write(ctx, target, value, profile) {
    // profile comes from widget-profiles.json — use it for DOM hooks.
    await ctx.driver.click(target);
    await ctx.driver.type(target, value, { clear: true });
    return {}; // return { via: 'fuzzy' | 'llm' } when the value needed guessing
  },

  async read(ctx, target) {
    return ctx.driver.readValue(target);
  },
};
```

Rules the executor relies on:

- **`write` is idempotent** — clear/reset before writing, so retries are safe.
- **`read` returns what the widget will actually submit** (normalised: trimmed,
  number/date forms). The executor compares with `valuesEqual` and retries on
  mismatch.
- Use `ctx.driver` only — no Playwright imports, no DOM assumptions beyond the
  `LocatorSpec` and profile. Match option choices go through `ctx.matchOption`
  (exact → fuzzy → LLM), never a private heuristic.
- A **new control kind** (not just a new adapter for an existing kind) also updates
  the `control` union in `adapter.ts`, the `control` enum in
  `packages/contracts/schemas/form-config.schema.json` (then `pnpm contracts:gen`).

### 2. Register it

In `packages/adapters/src/index.ts`:

```ts
registry.set('myWidget', myWidgetAdapter);
export { myWidgetAdapter };
```

The executor does `registry.get(step.control)` — an unregistered control fails fast.

### 3. Add a profile (if the widget needs DOM hooks)

Profiles are named per form in `configs/forms/<formId>/widget-profiles.json` —
locators for the widget's parts plus timing knobs:

```json
"acmeCombo": {
  "trigger": { "css": ".acme-combo__trigger" },
  "optionList": { "css": ".acme-combo__options" },
  "settleMs": 300,
  "maxWaitMs": 5000
}
```

Reference it from the field in `form.json` (`"profile": "acmeCombo"`); the config
loader rejects unknown profile names. See `fixtureSearchSelect` for the shape the
searchSelect adapter expects.

### 4. Write a fixture test

The fixture form (`apps/fixture-form`) exists so adapters are tested against a real
Angular page. Add a minimal instance of your widget to it, then a spec in
`packages/adapters/tests/` following the existing ones: `launchChromiumOverCdp()`
connects over CDP with the fixture already loaded; drive your adapter through the
`PlaywrightDriver`, write a value, read it back, and assert the form's `#model`
`<pre>` reflects it — that last assert proves Angular actually registered the input.

```
pnpm --filter @fib/adapters test
```

---

## PR checklist

- `pnpm lint` and the touched packages' test commands are green.
- Config changes pass `pnpm validate-configs`.
- Contract changes come with regenerated output (`pnpm contracts:gen`, CI fails on
  drift) and round-trip examples.
- New user-visible behaviour has a test at the lowest seam that can express it.
