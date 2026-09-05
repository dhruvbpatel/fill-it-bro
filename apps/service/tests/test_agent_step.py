"""Tests for POST /agent/step (T08)."""

import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient
from fib_service.main import app
from fib_service.providers import ToolCall, get_provider
from fib_service.providers.fake_provider import FakeProvider
from fib_service.routers.agent_step import _SYSTEM_PROMPT_PATH
from fib_service.tools.browser_tools import BROWSER_TOOLS

RESPONSE_SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages"
        / "contracts"
        / "schemas"
        / "agent-step-response.schema.json"
    ).read_text()
)

TOOL_QUEUE = [
    ToolCall(name="type", arguments={"ref": "e1", "text": "Goldman Sachs Incorporated"}),
    ToolCall(name="press", arguments={"ref": "e1", "key": "Enter"}),
    ToolCall(name="readValue", arguments={"ref": "e1"}),
    ToolCall(name="done", arguments={"value": "Goldman Sachs Incorporated"}),
]


def _request_body(history: list[dict] | None = None) -> dict:
    return {
        "goal": "Set the issuer field to Goldman Sachs Incorporated.",
        "fieldSpec": {"fieldId": "issuerName", "description": "Legal name of the issuer"},
        "a11ySnapshot": '- textbox "Issuer" [ref=e1]\n- button "Submit" [ref=e2]',
        "history": history or [],
    }


class RecordingFakeProvider(FakeProvider):
    def __init__(self, tool_queue: list[ToolCall]) -> None:
        super().__init__(tool_queue=tool_queue)
        self.calls: list[list[dict]] = []

    async def tool_step(self, tools: list[dict], messages: list[dict]) -> ToolCall:
        self.calls.append(messages)
        return await super().tool_step(tools, messages)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _override_provider(provider: FakeProvider) -> None:
    app.dependency_overrides[get_provider] = lambda: provider


@pytest.fixture(autouse=True)
def _clear_overrides() -> None:
    yield
    app.dependency_overrides.clear()


def test_tool_queue_yields_valid_responses_in_order(client: TestClient) -> None:
    _override_provider(FakeProvider(tool_queue=list(TOOL_QUEUE)))
    history: list[dict] = []

    for expected in TOOL_QUEUE:
        response = client.post("/agent/step", json=_request_body(history))

        assert response.status_code == 200
        body = response.json()
        assert body == {"tool": expected.name, **expected.arguments}
        jsonschema.validate(body, RESPONSE_SCHEMA)
        history.append({"toolCall": body, "observation": "value read back"})


def test_unknown_tool_returns_502(client: TestClient) -> None:
    _override_provider(FakeProvider(tool_queue=[ToolCall(name="screenshot", arguments={})]))

    response = client.post("/agent/step", json=_request_body())

    assert response.status_code == 502
    assert "screenshot" in response.json()["detail"]


def test_mismatched_arguments_return_502(client: TestClient) -> None:
    _override_provider(FakeProvider(tool_queue=[ToolCall(name="type", arguments={"ref": "e1"})]))

    response = client.post("/agent/step", json=_request_body())

    assert response.status_code == 502
    assert "type" in response.json()["detail"]


def test_builds_system_history_and_snapshot_messages() -> None:
    provider = RecordingFakeProvider(list(TOOL_QUEUE))
    _override_provider(provider)
    client = TestClient(app)

    history: list[dict] = []
    seen_messages: list[list[dict]] = []
    for expected in TOOL_QUEUE:
        response = client.post("/agent/step", json=_request_body(history))
        seen_messages.append(provider.calls[-1])
        history.append({"toolCall": response.json(), "observation": "ok"})
        assert response.json()["tool"] == expected.name

    first = seen_messages[0]
    assert [m["role"] for m in first] == ["system", "user"]
    assert first[0]["content"] == _SYSTEM_PROMPT_PATH.read_text()
    assert "issuerName" in first[1]["content"]
    assert "Accessibility snapshot:" in first[1]["content"]
    assert "[ref=e1]" in first[1]["content"]

    second = seen_messages[1]
    assert [m["role"] for m in second] == ["system", "assistant", "user", "user"]
    assert json.loads(second[1]["content"]) == {"tool": "type", "ref": "e1", "text": "Goldman Sachs Incorporated"}
    assert second[2]["content"].startswith("Observation:")


def test_exactly_the_seven_browser_tools_are_offered() -> None:
    assert [tool["name"] for tool in BROWSER_TOOLS] == [
        "click",
        "type",
        "press",
        "waitFor",
        "readValue",
        "done",
        "giveUp",
    ]
