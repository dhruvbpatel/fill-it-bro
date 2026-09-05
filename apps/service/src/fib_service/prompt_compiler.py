"""Compiles an ExtractionConfig group into a strict JSON schema and chat messages."""

from pathlib import Path

from .contracts.extraction_config_schema import ExtractionConfig, FieldDef
from .contracts.extraction_request_schema import Source

_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "extract_system.md"

_MAIN_GROUP_ID = "main"

_TYPE_MAP = {
    "string": "string",
    "date": "string",
    "number": "number",
    "boolean": "boolean",
}


def _cell_schema(field: FieldDef) -> dict:
    value_type = _TYPE_MAP.get(field.type, "string")
    value_schema: dict = {"type": [value_type, "null"]}
    if field.enum:
        value_schema["enum"] = [*field.enum, None]
    return {
        "type": "object",
        "description": field.description,
        "properties": {
            "value": value_schema,
            "itemIds": {"type": "array", "items": {"type": "string"}},
            "quote": {"type": "string"},
            "confidence": {"type": "number"},
            "reason": {"type": ["string", "null"]},
        },
        "required": ["value", "itemIds", "quote", "confidence", "reason"],
        "additionalProperties": False,
    }


def _fields_object_schema(title: str, fields: list[FieldDef]) -> dict:
    properties = {field.fieldId: _cell_schema(field) for field in fields}
    return {
        "title": title,
        "type": "object",
        "properties": properties,
        "required": [field.fieldId for field in fields],
        "additionalProperties": False,
    }


def _fields_for_group(extraction_config: ExtractionConfig, group_id: str) -> list[FieldDef]:
    if group_id == _MAIN_GROUP_ID:
        return extraction_config.fields
    for group in extraction_config.groups:
        if group.groupId == group_id:
            return group.fields
    raise KeyError(f"no group {group_id!r} in extraction config for {extraction_config.formId!r}")


def compile_schema(extraction_config: ExtractionConfig, group_id: str) -> dict:
    fields = _fields_for_group(extraction_config, group_id)
    title = f"{extraction_config.formId}_{group_id}"
    row_schema = _fields_object_schema(title, fields)
    if group_id == _MAIN_GROUP_ID:
        return row_schema
    return {
        "title": title,
        "type": "array",
        "items": {**row_schema, "title": f"{title}Row"},
    }


def compile_messages(schema: dict, source: Source) -> list[dict]:
    system_prompt = _SYSTEM_PROMPT_PATH.read_text()
    lines = []
    for page in source.pages:
        lines.append(f"## Page {page.mergedPage}")
        for item in page.items:
            lines.append(f"[{item.id}] {item.text}")
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "\n".join(lines)},
    ]
