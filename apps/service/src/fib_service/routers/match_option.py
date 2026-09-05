"""POST /match-option: semantic dropdown option choice for a wanted value."""

from pathlib import Path

from fastapi import APIRouter, Depends

from ..contracts.match_option_request_schema import MatchOptionRequest
from ..contracts.match_option_response_schema import MatchOptionResponse
from ..providers import LLMProvider, get_provider

router = APIRouter()

_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "match_option.md"

_SCHEMA = {
    "title": "MatchOptionResponse",
    "type": "object",
    "properties": {
        "index": {"type": ["integer", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "reason": {"type": "string"},
    },
    "required": ["index", "confidence", "reason"],
    "additionalProperties": False,
}


def _compile_messages(request: MatchOptionRequest) -> list[dict]:
    lines = [f"wanted: {request.wanted}", "options:"]
    lines.extend(f"[{i}] {option}" for i, option in enumerate(request.options))
    return [
        {"role": "system", "content": _SYSTEM_PROMPT_PATH.read_text()},
        {"role": "user", "content": "\n".join(lines)},
    ]


@router.post("/match-option", response_model=MatchOptionResponse)
async def match_option(
    request: MatchOptionRequest,
    provider: LLMProvider = Depends(get_provider),  # noqa: B008 (FastAPI DI convention)
) -> MatchOptionResponse:
    raw = await provider.structured(_SCHEMA, _compile_messages(request))
    response = MatchOptionResponse.model_validate(raw)
    if response.index is not None and not 0 <= response.index < len(request.options):
        response = response.model_copy(update={"index": None})
    return response
