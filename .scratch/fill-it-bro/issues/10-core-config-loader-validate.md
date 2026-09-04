# 10: Core: config loader + validate-configs

**What to build:** Loading a form's configs (`extraction.json`, `form.json`, `widget-profiles.json`, `templates.json`) validates them against the contracts, checks cross-file consistency, and ships the fixture form's real configs so every downstream ticket has a working example.

**Blocked by:** 02 (Contracts + codegen)

**Status:** done

## Read first
- PLAN.md §4 FormConfig/ExtractionConfig, §10, §15 widget profile example, ticket 14 field list.

## Do exactly this
- `packages/core/src/config/loadFormConfig.ts`: `loadFormBundle(configsDir, formId): FormBundle` = `{ formId, urlTemplate, extraction, form, profiles, neverClick: LocatorSpec[] }`. Ajv validation against `@fib/contracts` schemas. Errors are `ConfigError` with `file` and JSON pointer `path`.
- Cross checks: every `fieldId` in `form.json` exists in `extraction.json` and vice versa (grids: every `columns[].fieldId` exists in the group's fields); every `profile` referenced exists in `widget-profiles.json`; every field has at least one locator key; `urlTemplate` contains `{dealId}`.
- `neverClick` default: `[{ role: { role: 'button', name: '/^(submit|save|delete)$/i' } }]` merged with `form.json` optional `neverClick[]`.
- `packages/core/src/config/cli.ts` → root `pnpm validate-configs` iterating `configs/forms/*`.
- Write `configs/forms/fixtureDeal/extraction.json`, `form.json`, `widget-profiles.json` (exactly the profile from PLAN §15), and `prompts/issuerName.md` for the fixture (ticket 14): fields `issuerName`(string), `dealAmount`(number), `currency`(enum USD|EUR|GBP), `settlementDate`(date), `isConfidential`(boolean), `feeType`(enum Fixed|Variable); group `parties` with `partyName`(string), `role`(enum Issuer|Agent|Guarantor), `amount`(number). `form.json`: section `deal` (tab role tab name "Deal"; fields by `formControlName`; `feeType` with `reveal: [{action:'click', locator:{role:{role:'button',name:'Add fees'}}}]` and `dependsOn` none; `issuerName` control `searchSelect`, profile `fixtureSearchSelect`), section `parties` (tab "Parties"; grid `parties` control `agGrid`, locator `{css:'[data-testid="parties-grid"]'}`, addRow `{role:{role:'button',name:'Add row'}}`, columns partyName/text, role/select, amount/text).

## Acceptance criteria
- [x] `pnpm validate-configs` passes on `fixtureDeal`.
- [x] Tests: missing field parity, unknown profile, missing locator, bad enum each fail with the right `file` and `path`.
- [x] `neverClick` default present when `form.json` omits it.
