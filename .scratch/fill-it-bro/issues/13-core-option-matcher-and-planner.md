# 13: Core: option matcher + planner

**What to build:** Two pure functions: `matchOption` decides which dropdown option corresponds to a wanted value through exact → normalised → fuzzy → LLM tiers, and `buildPlan` turns a form config plus resolved fields into the ordered list of steps the executor runs.

**Blocked by:** 10 (Core: config loader + validate-configs)

**Status:** done

## Do exactly this
- `packages/core/src/match/matchOption.ts`: `matchOption(wanted, options, llm?: (w, o) => Promise<{index:number|null; confidence:number}>): Promise<{ index: number|null; via: 'exact'|'fuzzy'|'llm'|'none'; confidence: number }>`. Tiers: exact string; normalised (lowercase, trim, collapse spaces, strip punctuation, drop trailing legal suffixes from list `inc, incorporated, ltd, limited, llc, plc, corp, corporation, co`) exact and unique → `exact` 1.0; `tokenSetRatio ≥ 0.9` and unique best → `fuzzy` with the ratio; else `llm` if provided and returns index → `llm`; else `none`.
- `packages/core/src/plan/buildPlan.ts`: `buildPlan(bundle: FormBundle, fields: ResolvedField[], groups: ResolvedGroup[]): FillPlan`. Walk `form.sections` in order: emit `navigateTab` if `tab`; emit `reveal` steps; for each field with a non-null value emit `fillField { fieldId, control, locator, profile, value, valueType }`; fields with null value emit `stepSkipped` marker step `{kind:'fillField', skip:true, reason:'noValue'}`; grids: for row i, emit `addRow` when `i >= existingRows` (existingRows supplied via `opts.gridRowCounts[groupId] ?? 0`), then one `fillCell { groupId, rowIndex, colId, control, value }` per non-null cell. Respect `dependsOn`: a field is emitted after all fields it depends on within the same section.

## Acceptance criteria
- [x] `matchOption('Goldman Sachs', ['Goldman Sachs Incorporated','Goldman Sachs Asset Mgmt'])` → `llm` tier called (both fuzzy candidates), `none` when no llm.
- [x] `matchOption('goldman sachs inc.', ['Goldman Sachs Incorporated'])` → `exact` via normalisation.
- [x] Planner snapshot test on fixture bundle with 2 party rows and `gridRowCounts.parties = 1` → exactly one `addRow`.
- [x] `dependsOn` ordering enforced; cycle → throws `ConfigError`.
