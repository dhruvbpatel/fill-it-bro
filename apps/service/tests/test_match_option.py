from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fib_service.main import app
from fib_service.providers import FakeProvider, get_provider

PROMPT_PATH = Path(__file__).parents[1] / "src" / "fib_service" / "prompts" / "match_option.md"

REQUEST_BODY = {
    "wanted": "Goldman Sachs",
    "options": ["Goldman Sachs Incorporated", "Goldman Sachs Asset Mgmt"],
}


class ScriptedFakeProvider(FakeProvider):
    """FakeProvider whose structured() returns one canned dict and records the messages it saw."""

    def __init__(self, canned: dict) -> None:
        super().__init__()
        self._canned = canned
        self.seen_messages: list[dict] | None = None

    async def structured(self, schema: dict, messages: list[dict]) -> dict:
        self.seen_messages = messages
        return self._canned


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _override_provider(provider: FakeProvider) -> None:
    app.dependency_overrides[get_provider] = lambda: provider


@pytest.fixture(autouse=True)
def _clear_overrides() -> None:
    yield
    app.dependency_overrides.clear()


def test_fake_index_zero_is_returned(client: TestClient) -> None:
    provider = ScriptedFakeProvider({"index": 0, "confidence": 0.97, "reason": "same entity, longer legal name"})
    _override_provider(provider)

    response = client.post("/match-option", json=REQUEST_BODY)

    assert response.status_code == 200
    assert response.json() == {"index": 0, "confidence": 0.97, "reason": "same entity, longer legal name"}
    assert provider.seen_messages is not None
    assert provider.seen_messages[0] == {"role": "system", "content": PROMPT_PATH.read_text()}
    assert "[0] Goldman Sachs Incorporated" in provider.seen_messages[1]["content"]
    assert "[1] Goldman Sachs Asset Mgmt" in provider.seen_messages[1]["content"]


def test_out_of_range_index_becomes_null(client: TestClient) -> None:
    provider = ScriptedFakeProvider({"index": 7, "confidence": 0.9, "reason": "hallucinated index"})
    _override_provider(provider)

    response = client.post("/match-option", json=REQUEST_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["index"] is None
    assert body["confidence"] == 0.9
    assert body["reason"] == "hallucinated index"
