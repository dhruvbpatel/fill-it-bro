"""POST /extract: turns extraction config + page text into structured field values with citations."""

import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends

from ..config_loader import load_extraction_config
from ..contracts.citation_ref_schema import CitationRef
from ..contracts.extracted_field_schema import ExtractedField, Status
from ..contracts.extracted_group_schema import ExtractedGroup, Row
from ..contracts.extraction_config_schema import ExtractionConfig, FieldDef, GroupDef
from ..contracts.extraction_request_schema import ExtractionRequest, Source
from ..contracts.extraction_result_schema import ExtractionResult
from ..prompt_compiler import compile_messages, compile_schema
from ..providers import LLMProvider, get_provider
from ..settings import get_settings

router = APIRouter()

_MAIN_GROUP_ID = "main"


def _cell_to_field(field: FieldDef, cell: dict, source_id: str) -> ExtractedField:
    value = cell["value"]
    reason = cell.get("reason")
    if value is None:
        status = Status.notFound
    elif reason and reason.startswith("AMBIGUOUS:"):
        status = Status.ambiguous
    else:
        status = Status.found
    citations = [] if value is None else [CitationRef(itemIds=cell["itemIds"], quote=cell["quote"])]
    return ExtractedField(
        fieldId=field.fieldId,
        value=value,
        valueType=field.type,
        status=status,
        confidence=cell["confidence"],
        sourceId=source_id,
        citations=citations,
        reason=reason,
    )


async def _extract_main(
    provider: LLMProvider, extraction_config: ExtractionConfig, source: Source
) -> list[ExtractedField]:
    schema = compile_schema(extraction_config, _MAIN_GROUP_ID)
    raw = await provider.structured(schema, compile_messages(schema, source))
    return [_cell_to_field(field, raw[field.fieldId], source.sourceId) for field in extraction_config.fields]


async def _extract_group(
    provider: LLMProvider, extraction_config: ExtractionConfig, group: GroupDef, source: Source
) -> list[Row]:
    schema = compile_schema(extraction_config, group.groupId)
    raw_rows = await provider.structured(schema, compile_messages(schema, source))
    return [
        Row(cells=[_cell_to_field(field, raw_row[field.fieldId], source.sourceId) for field in group.fields])
        for raw_row in raw_rows
    ]


def _dump(dump_dir: str, run_id: str, request: ExtractionRequest, result: ExtractionResult) -> None:
    directory = Path(dump_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{run_id}.request.json").write_text(json.dumps(request.model_dump(), indent=2))
    (directory / f"{run_id}.result.json").write_text(json.dumps(result.model_dump(), indent=2))


@router.post("/extract", response_model=ExtractionResult)
async def extract(
    request: ExtractionRequest,
    provider: LLMProvider = Depends(get_provider),  # noqa: B008 (FastAPI DI convention)
) -> ExtractionResult:
    extraction_config = load_extraction_config(request.formId)

    fields: list[ExtractedField] = []
    grouped_rows: dict[str, list[Row]] = {group.groupId: [] for group in extraction_config.groups}
    for source in request.sources:
        fields.extend(await _extract_main(provider, extraction_config, source))
        for group in extraction_config.groups:
            grouped_rows[group.groupId].extend(
                await _extract_group(provider, extraction_config, group, source)
            )

    result = ExtractionResult(
        runId=str(uuid4()),
        fields=fields,
        groups=[ExtractedGroup(groupId=group_id, rows=rows) for group_id, rows in grouped_rows.items()],
    )

    dump_dir = get_settings().DUMP_EXTRACTION_DIR
    if dump_dir:
        _dump(dump_dir, result.runId, request, result)

    return result
