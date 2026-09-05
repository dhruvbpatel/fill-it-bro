import asyncio
import json
from pathlib import Path

import pytest
from fib_service.providers import FakeProvider
from fib_service.providers.base import ToolCall

FIXTURES_DIR = Path(__file__).parent / "fixtures"

SCHEMA = {
    "title": "DemoExtraction",
    "type": "object",
    "properties": {"issuerName": {"type": "object"}},
    "additionalProperties": False,
}


def test_structured_returns_fixture() -> None:
    provider = FakeProvider()
    result = asyncio.run(provider.structured(SCHEMA, [{"role": "user", "content": "extract"}]))
    assert result == json.loads((FIXTURES_DIR / "DemoExtraction.json").read_text())


def test_structured_keyed_by_title_plus_case() -> None:
    schema = {**SCHEMA, "title": "fixtureDeal_main"}
    provider = FakeProvider()
    with pytest.raises(OSError):
        asyncio.run(provider.structured(schema, []))
    case_provider = FakeProvider(case="basic-usd")
    result = asyncio.run(case_provider.structured(schema, []))
    assert result == json.loads((FIXTURES_DIR / "fixtureDeal_main__basic-usd.json").read_text())


def test_tool_step_pops_from_queue_in_order() -> None:
    provider = FakeProvider(
        tool_queue=[
            ToolCall(name="click", arguments={"ref": "e12"}),
            ToolCall(name="done", arguments={"value": "Goldman Sachs"}),
        ]
    )
    first = asyncio.run(provider.tool_step([{"type": "function", "name": "click"}], []))
    assert first == ToolCall(name="click", arguments={"ref": "e12"})
    second = asyncio.run(provider.tool_step([{"type": "function", "name": "done"}], []))
    assert second == ToolCall(name="done", arguments={"value": "Goldman Sachs"})
    with pytest.raises(RuntimeError, match="queue is empty"):
        asyncio.run(provider.tool_step([], []))
