import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fib_service.main import app
from fib_service.providers import FakeProvider, get_provider

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TEST_CONFIGS_DIR = FIXTURES_DIR / "configs"

REQUEST_BODY = {
    "formId": "testForm",
    "sources": [
        {
            "sourceId": "src1",
            "pages": [{"mergedPage": 1, "items": [{"id": "p1i1", "text": "100"}]}],
        },
        {
            "sourceId": "src2",
            "pages": [{"mergedPage": 1, "items": [{"id": "p1i1", "text": "100"}]}],
        },
    ],
}


class CountingFakeProvider(FakeProvider):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.calls = 0

    async def structured(self, schema: dict, messages: list[dict]) -> dict:
        self.calls += 1
        return await super().structured(schema, messages)


@pytest.fixture(autouse=True)
def _configs_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONFIGS_DIR", str(TEST_CONFIGS_DIR))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _override_provider(provider: FakeProvider) -> None:
    app.dependency_overrides[get_provider] = lambda: provider


@pytest.fixture(autouse=True)
def _clear_overrides() -> None:
    yield
    app.dependency_overrides.clear()


def test_calls_provider_once_per_source(client: TestClient) -> None:
    provider = CountingFakeProvider()
    _override_provider(provider)

    response = client.post("/extract", json=REQUEST_BODY)

    assert response.status_code == 200
    assert provider.calls == 2
    body = response.json()
    source_ids = {field["sourceId"] for field in body["fields"]}
    assert source_ids == {"src1", "src2"}


def test_null_value_becomes_not_found_with_empty_citations(client: TestClient) -> None:
    _override_provider(CountingFakeProvider())

    response = client.post("/extract", json=REQUEST_BODY)

    body = response.json()
    issuer_fields = [f for f in body["fields"] if f["fieldId"] == "issuer"]
    assert len(issuer_fields) == 2
    for field in issuer_fields:
        assert field["status"] == "notFound"
        assert field["value"] is None
        assert field["citations"] == []


def test_dump_files_written_when_dir_set(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DUMP_EXTRACTION_DIR", str(tmp_path))
    from fib_service.settings import get_settings

    get_settings.cache_clear()
    _override_provider(CountingFakeProvider())

    response = client.post("/extract", json=REQUEST_BODY)

    run_id = response.json()["runId"]
    assert (tmp_path / f"{run_id}.request.json").exists()
    assert (tmp_path / f"{run_id}.result.json").exists()
    result_dump = json.loads((tmp_path / f"{run_id}.result.json").read_text())
    assert result_dump["runId"] == run_id


def test_no_dump_files_when_dir_not_set(client: TestClient, tmp_path: Path) -> None:
    _override_provider(CountingFakeProvider())

    response = client.post("/extract", json=REQUEST_BODY)

    run_id = response.json()["runId"]
    assert not (tmp_path / f"{run_id}.request.json").exists()
