import importlib
import json
from pathlib import Path

import pytest

EXAMPLES_DIR = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "examples"
SCHEMA_NAMES = sorted(p.stem for p in EXAMPLES_DIR.glob("*.json"))


def pascal_case(name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in name.split("-"))


@pytest.mark.parametrize("name", SCHEMA_NAMES)
def test_roundtrip(name: str) -> None:
    module = importlib.import_module(f"fib_service.contracts.{name.replace('-', '_')}_schema")
    model_class = getattr(module, pascal_case(name))

    raw = json.loads((EXAMPLES_DIR / f"{name}.json").read_text())
    model = model_class.model_validate(raw)
    dumped = model.model_dump(mode="json", exclude_unset=True)

    assert dumped == raw
