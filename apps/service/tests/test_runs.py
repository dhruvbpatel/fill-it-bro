import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fib_service.main import app
from fib_service.settings import get_settings

RUN_BODY = {"user": "dhruv", "formId": "fixtureDeal", "dealId": "D-42", "sources": ["deal.msg"]}


def _event(run_id: str, payload: dict) -> dict:
    return {
        "runId": run_id,
        "ts": "2026-09-05T10:00:00+00:00",
        "user": "dhruv",
        "kind": "fieldFilled",
        "payload": payload,
    }


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def run_log_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "runs.jsonl"
    monkeypatch.setenv("RUN_LOG_PATH", str(path))
    get_settings.cache_clear()
    return path


def test_start_then_two_events_writes_three_lines(client: TestClient, run_log_path: Path) -> None:
    started = client.post("/runs", json=RUN_BODY)

    assert started.status_code == 200
    run_id = started.json()["runId"]
    first = client.post(
        f"/runs/{run_id}/events",
        json=_event(run_id, {"fieldId": "issuerName", "status": "verified", "via": "fuzzy", "confidence": 0.9}),
    )
    second = client.post(
        f"/runs/{run_id}/events",
        json=_event(
            run_id,
            {"fieldId": "dealAmount", "status": "failed", "reason": "locator timeout", "attempt": 3, "mergedPage": 2},
        ),
    )

    assert first.status_code == 204
    assert second.status_code == 204
    lines = [json.loads(line) for line in run_log_path.read_text().splitlines()]
    assert len(lines) == 3
    assert [line["runId"] for line in lines] == [run_id, run_id, run_id]
    assert lines[0]["kind"] == "runStarted"
    assert lines[0]["user"] == "dhruv"
    assert lines[0]["sources"] == ["deal.msg"]
    assert lines[1]["payload"]["fieldId"] == "issuerName"
    assert lines[2]["payload"]["fieldId"] == "dealAmount"


def test_event_with_disallowed_payload_key_is_rejected(client: TestClient, run_log_path: Path) -> None:
    run_id = client.post("/runs", json=RUN_BODY).json()["runId"]

    response = client.post(
        f"/runs/{run_id}/events",
        json=_event(run_id, {"fieldId": "issuerName", "pageText": "issuer: Goldman Sachs"}),
    )

    assert response.status_code == 422
    assert len(run_log_path.read_text().splitlines()) == 1
