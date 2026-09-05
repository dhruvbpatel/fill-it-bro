"""RunLogSink protocol with a JSONL-file v1 implementation; sink path comes from RUN_LOG_PATH."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from pydantic import BaseModel

from ..contracts.run_log_event_schema import RunLogEvent
from ..settings import get_settings


class RunMeta(BaseModel):
    """Body of POST /runs: who started which form for which deal over which source names."""

    user: str
    formId: str
    dealId: str
    sources: list[str]


class RunLogSink(Protocol):
    async def start(self, meta: RunMeta) -> str: ...

    async def event(self, run_id: str, event: RunLogEvent) -> None: ...


class JsonlFileSink:
    """Appends one JSON line per call; never receives document text beyond quoted snippets."""

    def __init__(self, path: str) -> None:
        self._path = Path(path)

    def _append(self, record: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a") as fh:
            fh.write(json.dumps(record) + "\n")

    async def start(self, meta: RunMeta) -> str:
        run_id = str(uuid4())
        self._append({"kind": "runStarted", "runId": run_id, "ts": datetime.now(UTC).isoformat(), **meta.model_dump()})
        return run_id

    async def event(self, run_id: str, event: RunLogEvent) -> None:
        self._append({**event.model_dump(mode="json"), "runId": run_id})


def get_sink() -> RunLogSink:
    return JsonlFileSink(get_settings().RUN_LOG_PATH)
