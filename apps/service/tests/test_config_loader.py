import json
from pathlib import Path

from fib_service.config_loader import load_extraction_config

FORM_DIR = Path(__file__).resolve().parents[3] / "configs" / "forms" / "fixtureDeal"


def test_prompt_file_overrides_inline_description() -> None:
    raw = json.loads((FORM_DIR / "extraction.json").read_text())
    inline_description = next(f["description"] for f in raw["fields"] if f["fieldId"] == "issuerName")
    prompt_text = (FORM_DIR / "prompts" / "issuerName.md").read_text().strip()

    config = load_extraction_config("fixtureDeal")

    issuer = next(f for f in config.fields if f.fieldId == "issuerName")
    assert issuer.description == prompt_text
    assert issuer.description != inline_description


def test_missing_prompt_file_falls_back_to_inline_description() -> None:
    raw = json.loads((FORM_DIR / "extraction.json").read_text())
    inline_description = next(f["description"] for f in raw["fields"] if f["fieldId"] == "dealAmount")
    assert not (FORM_DIR / "prompts" / "dealAmount.md").exists()

    config = load_extraction_config("fixtureDeal")

    deal_amount = next(f for f in config.fields if f.fieldId == "dealAmount")
    assert deal_amount.description == inline_description
