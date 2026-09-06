# @fib/core

Pure TypeScript, no Electron/DOM imports: the framework-free brains shared by the
desktop host and tests.

## Public API

- **Session state machine** (`src/session.ts`) — `reduce(snapshot, event)` per PLAN §5
  (`idle → launching → … → review → done`, `failed` reachable anywhere). Pure; throws
  `IllegalTransition` on an illegal edge.
- **Config loader** (`src/config/loadFormConfig.ts`) — `loadFormBundle(configsDir, formId)`
  loads and Ajv-validates `configs/forms/<formId>/{extraction,form,widget-profiles}.json`
  and `configs/templates.json`, then runs the cross-file checks (field-id parity between
  extraction.json and form.json, profile references, grid-column/group parity) and merges
  the `neverClick` defaults (`Submit|Save|Delete` role-button regex). Throws `ConfigError`
  with the file and JSON-pointer path.
- **`pnpm validate-configs`** — CLI wrapper (`src/config/cli.ts`) that validates every
  form directory; exits non-zero with path-qualified errors.
- **Citation resolver** (`src/citations/resolve.ts`) — `resolve(set, result, findPhrase)`:
  itemIds → boxes, quote verification (normalised substring, else token ratio ≥ 0.9),
  `findPhrase` fallback, `unverifiedCitation` + capped confidence when nothing matches,
  `sourceId/sourcePage` attached from the manifest.
- **Option matcher** (`src/match/matchOption.ts`) — `matchOption(wanted, options, llm?)`:
  exact → normalised (case/punctuation/`Inc`-suffix) → token-set ratio ≥ 0.9 and unique →
  `llm` callback → `none`.
- **Planner** (`src/plan/buildPlan.ts`) — `buildPlan(bundle, fields, groups, opts)`:
  ordered `FillStep`s (navigateTab/reveal/fillField/addRow/fillCell), skipping empty values.
- **Driver interface** (`src/driver.ts`) — the `BrowserDriver`, `LocatorSpec`, `Ref`
  types every browser-control seam implements.
- **Text similarity** (`src/text/similarity.ts`) — `normalise`, `tokenSetRatio`.

## How to test

```
pnpm --filter @fib/core test
```
