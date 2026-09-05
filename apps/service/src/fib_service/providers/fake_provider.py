"""Fake provider serving canned fixtures; used by tests and local dev."""

import json
from pathlib import Path

from .base import ToolCall

DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures"


class FakeProvider:
    def __init__(
        self,
        fixtures_dir: Path | None = None,
        tool_queue: list[ToolCall] | None = None,
    ) -> None:
        self._fixtures_dir = fixtures_dir or DEFAULT_FIXTURES_DIR
        self._tool_queue = list(tool_queue) if tool_queue else []

    async def structured(self, schema: dict, messages: list[dict]) -> dict:
        path = self._fixtures_dir / f"{schema['title']}.json"
        return json.loads(path.read_text())

    async def tool_step(self, tools: list[dict], messages: list[dict]) -> ToolCall:
        if not self._tool_queue:
            raise RuntimeError("fake provider tool queue is empty")
        return self._tool_queue.pop(0)
