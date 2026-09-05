# 09: Service /match-option + /runs

**What to build:** `POST /match-option` picks the semantically right dropdown option for a wanted value (or says none), and `/runs` + `/runs/{id}/events` record a run log through a pluggable sink that never receives document text beyond cited quotes.

**Blocked by:** 05 (Service skeleton + LLMProvider)

**Status:** done

## Do exactly this
- `routers/match_option.py`: schema `{ index: int|null, confidence: number, reason: string }` via `provider.structured`; system prompt `fib_service/prompts/match_option.md` (choose the option that denotes the same entity as `wanted`, e.g. "Goldman Sachs" ↔ "Goldman Sachs Incorporated"; return null if none clearly does). Validate `index` is within `len(options)` else set null.
- `fib_service/runlog/base.py`: `class RunLogSink(Protocol): async def start(meta) -> str; async def event(run_id, event: RunLogEvent) -> None`. `JsonlFileSink` appends one JSON line per call to `RUN_LOG_PATH`. `get_sink()` dependency.
- `routers/runs.py`: `POST /runs` body `{ user, formId, dealId, sources: string[] }` → `{ runId }`; `POST /runs/{runId}/events` body `RunLogEvent` → 204. Reject (422) any event whose `payload` contains keys other than `fieldId, status, via, confidence, quote, reason, attempt, sourceId, mergedPage`.

## Acceptance criteria
- [x] pytest: fake returns index 0 → response index 0; fake returns index 7 for 2 options → null.
- [x] `/runs` then two events → 3 lines in the JSONL file with matching `runId`.
- [x] Event with payload key `pageText` → 422.
