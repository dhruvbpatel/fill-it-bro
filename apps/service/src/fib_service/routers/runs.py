"""POST /runs and /runs/{runId}/events: run-log sink endpoints (names, outcomes, quotes only)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..contracts.run_log_event_schema import RunLogEvent
from ..runlog import RunLogSink, RunMeta, get_sink

router = APIRouter()

_ALLOWED_PAYLOAD_KEYS = frozenset(
    {"fieldId", "status", "via", "confidence", "quote", "reason", "attempt", "sourceId", "mergedPage"}
)


class RunStarted(BaseModel):
    runId: str


@router.post("/runs", response_model=RunStarted)
async def start_run(
    meta: RunMeta,
    sink: RunLogSink = Depends(get_sink),  # noqa: B008 (FastAPI DI convention)
) -> RunStarted:
    return RunStarted(runId=await sink.start(meta))


@router.post("/runs/{runId}/events", status_code=204)
async def append_event(
    runId: str,
    event: RunLogEvent,
    sink: RunLogSink = Depends(get_sink),  # noqa: B008 (FastAPI DI convention)
) -> None:
    disallowed = sorted(set(event.payload) - _ALLOWED_PAYLOAD_KEYS)
    if disallowed:
        raise HTTPException(status_code=422, detail=f"payload keys not allowed: {disallowed}")
    await sink.event(runId, event)
