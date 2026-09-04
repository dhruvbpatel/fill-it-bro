# 27: Eval harness + synthetic goldens

**What to build:** A command that runs extraction over a golden set and reports per-field accuracy and citation validity, plus a generated synthetic golden set so CI exercises it end to end.

**Blocked by:** 07 (Service /extract), 03 (Ingest: PDF → DocumentSet)

**Status:** ready-for-agent

## Read first
- PLAN.md §11.

## Do exactly this
- `evals/harness/src/fib_evals/cli.py` → script `evals`: `uv run evals --forms configs/forms --golden <dir> --provider fake|openai --out evals/out`. Golden layout: `<dir>/<formId>/<case>/documentSet.json` (contract shape, text only) and `expected.json` (`{ fields: { fieldId: value }, groups: { groupId: [ { colId: value } ] } }`).
- For each case: run the extract logic in-process (import the router's service function, not HTTP), compare each field: `exact`, `normalised` (same rules as core `normalise`), `fuzzy` (token-set ≥ 0.9); citation check: every `itemId` exists in the documentSet and the joined item text contains the normalised value. Report: markdown table per form (field, n, exact %, normalised %, fuzzy %, citation-valid %) and `report.json`. Exit 1 if `--min-accuracy` (default 0) not met.
- `evals/synthetic/generate.py` (script `evals-synth`): builds 3 cases for `fixtureDeal` by writing simple PDFs with `reportlab` (or `pdf-lib` via a small Node script; pick reportlab), running `@fib/ingest` through a Node helper `packages/ingest/scripts/ingest-cli.ts <pdf> > documentSet.json`, and writing `expected.json`. Commit the generated cases under `evals/synthetic/cases/`.
- FakeProvider fixture for these cases must return correct values so CI accuracy is 100 % (author `apps/service/tests/fixtures/` accordingly, keyed by schema title + case).

## Acceptance criteria
- [ ] `uv run evals --golden evals/synthetic/cases --provider fake --min-accuracy 1.0` exits 0 in CI.
- [ ] Report lists every fixture field and both groups.
- [ ] Wrong expected value in a temp copy → exit 1.
