import asyncio
import json
from types import SimpleNamespace
from typing import Any

import httpx
import jsonschema
import pytest
from fib_service.providers.openai_provider import OpenAIProvider
from openai import APIStatusError, BadRequestError, InternalServerError

SCHEMA = {
    "title": "DemoExtraction",
    "type": "object",
    "properties": {"issuerName": {"type": "string"}},
    "required": ["issuerName"],
    "additionalProperties": False,
}
MESSAGES = [{"role": "user", "content": "extract issuer"}]


def status_error(cls: type[APIStatusError], code: int) -> APIStatusError:
    request = httpx.Request("POST", "https://gateway.example/v1/responses")
    response = httpx.Response(code, request=request)
    return cls("gateway rejected the call", response=response, body=None)


class StubResponses:
    def __init__(self, payload: Any = None, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._payload


class StubChatCompletions:
    def __init__(self, content: str = "{}") -> None:
        self._content = content
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        message = SimpleNamespace(content=self._content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class StubClient:
    def __init__(self, responses: StubResponses, chat: StubChatCompletions) -> None:
        self.responses = responses
        self.chat = SimpleNamespace(completions=chat)



def make_provider(
    responses: StubResponses, chat: StubChatCompletions
) -> OpenAIProvider:
    return OpenAIProvider(
        base_url="https://gateway.example/v1",
        api_key="test-key",
        model="gpt-4o",
        client=StubClient(responses, chat),  # type: ignore[arg-type]
    )


def test_structured_success_via_responses() -> None:
    expected = {"issuerName": "Goldman Sachs Incorporated"}
    responses = StubResponses(
        payload=SimpleNamespace(output_text=json.dumps(expected), output=[])
    )
    chat = StubChatCompletions()
    result = asyncio.run(make_provider(responses, chat).structured(SCHEMA, MESSAGES))

    assert result == expected
    assert len(responses.calls) == 1
    assert responses.calls[0]["text"] == {
        "format": {"type": "json_schema", "name": "DemoExtraction", "schema": SCHEMA, "strict": True}
    }
    assert chat.calls == []


def test_structured_falls_back_to_chat_completions_on_400() -> None:
    expected = {"issuerName": "Goldman Sachs Incorporated"}
    responses = StubResponses(error=status_error(BadRequestError, 400))
    chat = StubChatCompletions(content=json.dumps(expected))
    result = asyncio.run(make_provider(responses, chat).structured(SCHEMA, MESSAGES))

    assert result == expected
    assert len(chat.calls) == 1
    call = chat.calls[0]
    assert call["response_format"] == {"type": "json_object"}
    assert call["messages"][0]["role"] == "system"
    assert "DemoExtraction" in call["messages"][0]["content"]


def test_structured_does_not_fallback_on_5xx() -> None:
    responses = StubResponses(error=status_error(InternalServerError, 500))
    chat = StubChatCompletions()

    with pytest.raises(APIStatusError):
        asyncio.run(make_provider(responses, chat).structured(SCHEMA, MESSAGES))
    assert chat.calls == []


def test_structured_validates_payload_against_schema() -> None:
    responses = StubResponses(error=status_error(BadRequestError, 400))
    chat = StubChatCompletions(content=json.dumps({"unexpected": True}))

    with pytest.raises(jsonschema.ValidationError):
        asyncio.run(make_provider(responses, chat).structured(SCHEMA, MESSAGES))


def test_tool_step_returns_first_function_call() -> None:
    function_call = SimpleNamespace(
        type="function_call", name="click", arguments='{"ref": "e12"}'
    )
    message = SimpleNamespace(type="message")
    responses = StubResponses(
        payload=SimpleNamespace(output_text="", output=[message, function_call])
    )
    chat = StubChatCompletions()
    result = asyncio.run(
        make_provider(responses, chat).tool_step(
            [{"type": "function", "name": "click"}], MESSAGES
        )
    )

    assert result.name == "click"
    assert result.arguments == {"ref": "e12"}
    assert responses.calls[0]["tools"] == [{"type": "function", "name": "click"}]


def test_tool_step_raises_without_function_call() -> None:
    responses = StubResponses(
        payload=SimpleNamespace(output_text="", output=[SimpleNamespace(type="message")])
    )
    with pytest.raises(RuntimeError, match="no function call"):
        asyncio.run(make_provider(responses, StubChatCompletions()).tool_step([], MESSAGES))


def test_constructor_requires_gateway_config() -> None:
    with pytest.raises(ValueError, match="GATEWAY_BASE_URL"):
        OpenAIProvider(base_url="", api_key="test-key", model="gpt-4o")
    with pytest.raises(ValueError, match="GATEWAY_BASE_URL"):
        OpenAIProvider(base_url="https://gateway.example", api_key="", model="gpt-4o")
