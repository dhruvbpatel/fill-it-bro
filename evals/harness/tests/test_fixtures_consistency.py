"""Guards the committed eval inputs: per-case FakeProvider fixtures must stay in sync
with the committed documentSet.json (ids exist, joined item text contains the value)."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fib_evals.compare import citation_valid
from fib_service.contracts.document_set_schema import DocumentSet

REPO_ROOT = Path(__file__).resolve().parents[3]
CASES_DIR = REPO_ROOT / "evals" / "synthetic" / "cases" / "fixtureDeal"
FIXTURES_DIR = REPO_ROOT / "apps" / "service" / "tests" / "fixtures"

CASE_NAMES = sorted(p.name for p in CASES_DIR.iterdir() if p.is_dir())


@pytest.mark.parametrize("case_name", CASE_NAMES)
def test_fake_fixtures_cite_valid_items(case_name: str) -> None:
    document_set = DocumentSet.model_validate(
        json.loads((CASES_DIR / case_name / "documentSet.json").read_text())
    )
    items_by_id = {item.id: item for page in document_set.pages for item in page.items}

    fixture_files = [
        FIXTURES_DIR / f"fixtureDeal_main__{case_name}.json",
        FIXTURES_DIR / f"fixtureDeal_parties__{case_name}.json",
    ]
    cells = []
    for fixture_file in fixture_files:
        payload = json.loads(fixture_file.read_text())
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            for cell in row.values():
                cells.append(
                    SimpleNamespace(
                        value=cell["value"], citations=[SimpleNamespace(itemIds=cell["itemIds"])]
                    )
                )

    assert cells, f"no fixture cells found for case {case_name}"
    for cell in cells:
        assert citation_valid(cell, items_by_id), (
            f"invalid citation in {case_name}: {cell.value!r}"
        )
