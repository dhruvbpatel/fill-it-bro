"""Liveness probe reporting the active provider."""

from fastapi import APIRouter

from ..settings import get_settings

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, bool | str]:
    return {"ok": True, "provider": get_settings().PROVIDER}
