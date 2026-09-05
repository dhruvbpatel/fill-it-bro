"""OpenAI-compatible gateway provider (Responses API with chat-completions fallback)."""

import json
from typing import Any

import jsonschema
from openai import APIStatusError, AsyncOpenAI

from .base import ToolCall


def _is_4xx(err: APIStatusError) -> bool:
    return 400 <= err.status_code < 500


class OpenAIProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        client: AsyncOpenAI | None = None,
    ) -> None:
        if not base_url or not api_key:
            raise ValueError(
                "GATEWAY_BASE_URL and GATEWAY_API_KEY must be set for the openai provider"
            )
        self._model = model
        self._client = client or AsyncOpenAI(base_url=base_url, api_key=api_key)

    async def structured(self, schema: dict, messages: list[dict]) -> dict:
        try:
            response = await self._client.responses.create(
                model=self._model,
                input=messages,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": schema["title"],
                        "schema": schema,
                        "strict": True,
                    }
                },
            )
            payload = json.loads(response.output_text)
        except APIStatusError as err:
            if not _is_4xx(err):
                raise
            payload = await self._structured_via_chat(schema, messages)
        jsonschema.validate(payload, schema)
        return payload

    async def _structured_via_chat(self, schema: dict, messages: list[dict]) -> Any:
        system = {
            "role": "system",
            "content": (
                "Respond with a single JSON object that strictly conforms to "
                "this JSON Schema:\n" + json.dumps(schema)
            ),
        }
        completion = await self._client.chat.completions.create(
            model=self._model,
            messages=[system, *messages],
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content or ""
        return json.loads(content)

    async def tool_step(self, tools: list[dict], messages: list[dict]) -> ToolCall:
        response = await self._client.responses.create(
            model=self._model,
            input=messages,
            tools=tools,
        )
        for item in response.output:
            if getattr(item, "type", None) == "function_call":
                return ToolCall(
                    name=item.name,
                    arguments=json.loads(item.arguments) if item.arguments else {},
                )
        raise RuntimeError("model returned no function call")
