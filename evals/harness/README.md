# fib_evals

Extraction accuracy harness: runs the service's `/extract` logic in-process over a
golden set and reports per-field accuracy, so prompt changes are measured, not guessed.
The same harness later compares providers (`--provider openai|fake`).

## Usage

```
uv run evals --forms configs/forms --golden evals/synthetic/cases --provider fake
```

- `--golden <dir>` — `<dir>/<formId>/<case>/documentSet.json` + `expected.json`.
  Real goldens live on a share (`$GOLDEN_DIR`); `evals/synthetic` is the committed set
  CI uses.
- `--min-accuracy 1.0` — exit 1 below the threshold (CI runs with 1.0 on synthetic).
- Writes `report.md` + `report.json` to `--out` (default `evals/out`): per-field
  exact/normalised/fuzzy comparison, and whether each citation's itemIds point at text
  containing the value.

## How to test

```
uv run pytest          # repo root; this package's tests are in tests/
```

The FakeProvider path needs no network and no gateway credentials.
