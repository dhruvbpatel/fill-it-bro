"""LLMProvider protocol shared by every provider implementation."""

from typing import Protocol

from pydantic import BaseModel


class ToolCall(BaseModel):
    name: str
    arguments: dict


class LLMProvider(Protocol):
    async def structured(self, schema: dict, messages: list[dict]) -> dict: ...

    async def tool_step(self, tools: list[dict], messages: list[dict]) -> ToolCall: ...
