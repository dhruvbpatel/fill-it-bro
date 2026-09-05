"""Golden-set discovery and conversion of a text-only DocumentSet into an ExtractionRequest."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from fib_service.contracts.document_set_schema import DocumentSet
from fib_service.contracts.extraction_request_schema import (
    ExtractionRequest,
    Item,
    Page,
    Source,
)


@dataclass
class GoldenCase:
    form_id: str
    case_id: str
    document_set: DocumentSet
    expected: dict


def discover_cases(golden_dir: Path) -> list[GoldenCase]:
    """Cases live at <golden_dir>/<formId>/<case>/ with documentSet.json + expected.json."""
    cases: list[GoldenCase] = []
    for form_dir in sorted(p for p in golden_dir.iterdir() if p.is_dir()):
        for case_dir in sorted(p for p in form_dir.iterdir() if p.is_dir()):
            document_set = DocumentSet.model_validate(
                json.loads((case_dir / "documentSet.json").read_text())
            )
            expected = json.loads((case_dir / "expected.json").read_text())
            cases.append(
                GoldenCase(
                    form_id=form_dir.name,
                    case_id=case_dir.name,
                    document_set=document_set,
                    expected=expected,
                )
            )
    return cases


def to_request(form_id: str, document_set: DocumentSet) -> ExtractionRequest:
    """Route each merged page to its source via the manifest; text items only."""
    page_to_source = {entry.mergedPage: entry.sourceId for entry in document_set.manifest}
    pages_by_source: dict[str, list[Page]] = {}
    for page in document_set.pages:
        source_id = page_to_source.get(page.mergedPage)
        if source_id is None:
            continue
        pages_by_source.setdefault(source_id, []).append(
            Page(
                mergedPage=page.mergedPage,
                items=[Item(id=item.id, text=item.text) for item in page.items],
            )
        )
    sources = [
        Source(sourceId=source.sourceId, pages=pages_by_source.get(source.sourceId, []))
        for source in document_set.sources
    ]
    return ExtractionRequest(formId=form_id, sources=sources)


def items_by_id(document_set: DocumentSet) -> dict[str, str]:
    return {item.id: item.text for page in document_set.pages for item in page.items}
