import pytest
from fastapi.testclient import TestClient
from fib_service.main import app
from fib_service.providers import FakeProvider, OpenAIProvider, get_provider
from fib_service.settings import get_settings


def test_healthz_reports_fake_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER", "fake")
    get_settings.cache_clear()

    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "provider": "fake"}


def test_provider_selected_by_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER", "fake")
    get_settings.cache_clear()
    assert isinstance(get_provider(), FakeProvider)

    monkeypatch.setenv("PROVIDER", "openai")
    monkeypatch.setenv("GATEWAY_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("GATEWAY_API_KEY", "test-key")
    get_settings.cache_clear()
    assert isinstance(get_provider(), OpenAIProvider)


def test_defaults_and_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    assert settings.MODEL == "gpt-4o"
    assert settings.DUMP_EXTRACTION_DIR is None
    assert settings.RUN_LOG_PATH == "./runs.jsonl"

    monkeypatch.setenv("MODEL", "claude-4")
    monkeypatch.setenv("DUMP_EXTRACTION_DIR", "/tmp/dump")
    monkeypatch.setenv("RUN_LOG_PATH", "/tmp/runs.jsonl")
    get_settings.cache_clear()

    settings = get_settings()
    assert settings.MODEL == "claude-4"
    assert settings.DUMP_EXTRACTION_DIR == "/tmp/dump"
    assert settings.RUN_LOG_PATH == "/tmp/runs.jsonl"
