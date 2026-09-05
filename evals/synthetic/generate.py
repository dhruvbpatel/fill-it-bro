"""Generates the synthetic golden set (T27): 3 PDF cases for `fixtureDeal` + FakeProvider fixtures.

Run via `uv run evals-synth`. Needs the node workspace installed (`pnpm install`) because
documentSet.json comes from @fib/ingest through packages/ingest/scripts/ingest-cli.ts.
Outputs (all committed):
  - evals/synthetic/cases/fixtureDeal/<case>/documentSet.json + expected.json
  - apps/service/tests/fixtures/fixtureDeal_{main,parties}__<case>.json
    (FakeProvider canned responses, keyed by schema title + case, with itemIds valid
    for the committed documentSet)
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

REPO_ROOT = Path(__file__).resolve().parents[2]
FORM_ID = "fixtureDeal"
CONFIDENCE = 0.99

CASES: list[dict] = [
    {
        "name": "basic-usd",
        "pages": [
            [
                "Deal Term Sheet",
                "Issuer: Goldman Sachs Incorporated",
                "Deal Amount: 1500000",
                "Currency: USD",
                "Settlement Date: 2026-10-15",
                "Confidential: true",
                "Fee Type: Fixed",
                "Party: Goldman Sachs Incorporated Role: Issuer Amount: 250000",
            ]
        ],
        "fields": {
            "issuerName": "Goldman Sachs Incorporated",
            "dealAmount": 1500000,
            "currency": "USD",
            "settlementDate": "2026-10-15",
            "isConfidential": True,
            "feeType": "Fixed",
        },
        "groups": {
            "parties": [
                {
                    "partyName": "Goldman Sachs Incorporated",
                    "role": "Issuer",
                    "amount": 250000,
                }
            ]
        },
    },
    {
        "name": "eur-variable",
        "pages": [
            [
                "Deal Term Sheet",
                "Issuer: Bridge Partners Limited",
                "Deal Amount: 2750000",
                "Currency: EUR",
                "Settlement Date: 2026-11-30",
                "Confidential: false",
                "Fee Type: Variable",
                "Party: Bridge Partners Limited Role: Agent Amount: 125000",
            ]
        ],
        "fields": {
            "issuerName": "Bridge Partners Limited",
            "dealAmount": 2750000,
            "currency": "EUR",
            "settlementDate": "2026-11-30",
            "isConfidential": False,
            "feeType": "Variable",
        },
        "groups": {
            "parties": [
                {
                    "partyName": "Bridge Partners Limited",
                    "role": "Agent",
                    "amount": 125000,
                }
            ]
        },
    },
    {
        "name": "gbp-two-parties",
        "pages": [
            [
                "Deal Term Sheet",
                "Issuer: Kestrel Capital Group",
                "Deal Amount: 980000",
                "Currency: GBP",
                "Settlement Date: 2027-01-22",
                "Confidential: true",
                "Fee Type: Fixed",
            ],
            [
                "Parties",
                "Party: Kestrel Capital Group Role: Issuer Amount: 980000",
                "Party: Meridian Trading LLC Role: Agent Amount: 300000",
            ],
        ],
        "fields": {
            "issuerName": "Kestrel Capital Group",
            "dealAmount": 980000,
            "currency": "GBP",
            "settlementDate": "2027-01-22",
            "isConfidential": True,
            "feeType": "Fixed",
        },
        "groups": {
            "parties": [
                {
                    "partyName": "Kestrel Capital Group",
                    "role": "Issuer",
                    "amount": 980000,
                },
                {"partyName": "Meridian Trading LLC", "role": "Agent", "amount": 300000},
            ]
        },
    },
]


def write_pdf(path: Path, pages: list[list[str]]) -> None:
    canvas = Canvas(str(path), pagesize=A4)
    for lines in pages:
        y = 750
        for line in lines:
            canvas.drawString(72, y, line)
            y -= 20
        canvas.showPage()
    canvas.save()


def run_ingest_cli(pdf_path: Path) -> dict:
    result = subprocess.run(
        ["pnpm", "--filter", "@fib/ingest", "exec", "tsx", "scripts/ingest-cli.ts", str(pdf_path)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def find_item_ids(document_set: dict, value: object) -> tuple[list[str], str]:
    """Smallest window of consecutive items whose joined normalised text contains the value."""
    target = _normalise(_stringify(value))
    if not target:
        raise ValueError(f"cannot cite empty value {value!r}")
    for page in document_set["pages"]:
        items = page["items"]
        texts = [_normalise(item["text"]) for item in items]
        for size in range(1, len(items) + 1):
            for start in range(len(items) - size + 1):
                window = texts[start : start + size]
                if target in " ".join(window):
                    cited = items[start : start + size]
                    quote = " ".join(item["text"] for item in cited).strip()
                    return [item["id"] for item in cited], quote
    raise ValueError(f"value {value!r} not found in generated document set")


def _normalise(text: str) -> str:
    lowered = text.lower()
    stripped = re.sub(r"[^a-z0-9\s.,\-/]", "", lowered)
    return re.sub(r"\s+", " ", stripped).strip()


def _stringify(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def make_cell(document_set: dict, value: object) -> dict:
    item_ids, quote = find_item_ids(document_set, value)
    return {
        "value": value,
        "itemIds": item_ids,
        "quote": quote,
        "confidence": CONFIDENCE,
        "reason": None,
    }


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    fixtures_dir = REPO_ROOT / "apps" / "service" / "tests" / "fixtures"
    cases_dir = REPO_ROOT / "evals" / "synthetic" / "cases" / FORM_ID
    with tempfile.TemporaryDirectory() as tmp:
        for case in CASES:
            pdf_path = Path(tmp) / f"{case['name']}.pdf"
            write_pdf(pdf_path, case["pages"])
            document_set = run_ingest_cli(pdf_path)

            case_dir = cases_dir / case["name"]
            write_json(case_dir / "documentSet.json", document_set)
            write_json(
                case_dir / "expected.json",
                {"fields": case["fields"], "groups": case["groups"]},
            )

            main_cells = {
                field_id: make_cell(document_set, value)
                for field_id, value in case["fields"].items()
            }
            write_json(fixtures_dir / f"{FORM_ID}_main__{case['name']}.json", main_cells)
            for group_id, rows in case["groups"].items():
                row_cells = [
                    {col_id: make_cell(document_set, value) for col_id, value in row.items()}
                    for row in rows
                ]
                write_json(
                    fixtures_dir / f"{FORM_ID}_{group_id}__{case['name']}.json", row_cells
                )
            print(
                f"generated {FORM_ID}/{case['name']}: "
                f"{len(document_set['pages'])} pages, "
                f"{sum(len(p['items']) for p in document_set['pages'])} items"
            )
    print(f"cases written to {cases_dir}; FakeProvider fixtures written to {fixtures_dir}")


if __name__ == "__main__":
    main()
