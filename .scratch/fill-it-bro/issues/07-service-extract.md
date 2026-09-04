# 07: Service /extract

**What to build:** `POST /extract` turns a form's extraction config plus page text with item ids into structured field values with citations, one LLM call per source document per field group, with an optional local JSON dump for developers.

**Blocked by:** 05 (Service skeleton + LLMProvider)

**Status:** ready-for-agent

## Read first
- PLAN.md §4 ExtractionRequest/Result, §7 `/extract`, §10 config layout.

## Do exactly this
- `fib_service/config_loader.py`: load `configs/forms/<formId>/extraction.json` and `prompts/<fieldId>.md` (path from setting `CONFIGS_DIR`, default `../../configs` relative to repo root). Missing prompt file → use inline `description`.
- `fib_service/prompt_compiler.py`: `compile_schema(extraction_config, group_id) -> dict` producing a strict JSON schema: object with one property per field `{ value: <type|null>, itemIds: string[], quote: string, confidence: number, reason: string }`; groups become arrays of row objects with the same per-cell shape. Property `description` = prompt text. `compile_messages(schema, source) -> list[dict]`: system prompt from `fib_service/prompts/extract_system.md` (write it: cite only item ids that exist, quote verbatim, null when absent, never guess), user message = page text formatted as lines `[p3i17] text` grouped under `## Page 3`.
- `routers/extract.py`: for each `source` in request, for each group in config (default single group `main`), call `provider.structured`; assemble `ExtractionResult` (`status: notFound` when value is null, `ambiguous` when provider returns `reason` starting with `AMBIGUOUS:`); `runId = uuid4`. If `DUMP_EXTRACTION_DIR` set, write `<runId>.request.json` and `<runId>.result.json` there.
- Validate output against generated `ExtractionResult` model before returning.

## Acceptance criteria
- [ ] pytest with FakeProvider: request with 2 sources and a config with 1 group → provider called exactly 2 times, results carry correct `sourceId`.
- [ ] A field the fake returns as null comes back `status: notFound`, `value: null`, empty citations.
- [ ] Dump files appear when `DUMP_EXTRACTION_DIR` is set and not otherwise.
- [ ] Compiled schema for the fixture config validates as JSON Schema and includes every field's description.
