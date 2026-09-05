"""POST /agent/step: stateless one-tool-call fallback agent endpoint."""

from pathlib import Path

import jsonschema
from fastapi import APIRouter, Depends, HTTPException

from ..contracts.agent_step_request_schema import AgentStepRequest
from ..contracts.agent_step_response_schema import AgentStepResponse
from ..providers import LLMProvider, ToolCall, get_provider
from ..tools.browser_tools import BROWSER_TOOLS

router = APIRouter()

_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "agent_step.md"

_TOOL_PARAMETERS = {tool["name"]: tool["parameters"] for tool in BROWSER_TOOLS}


def _build_messages(request: AgentStepRequest) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT_PATH.read_text()}]
    for entry in request.history:
        messages.append({"role": "assistant", "content": entry.toolCall.model_dump_json()})
        messages.append({"role": "user", "content": f"Observation: {entry.observation}"})
    field_spec = request.fieldSpec
    user_content = (
        f"Goal: {request.goal}\n"
        f"Field: {field_spec.fieldId}"
        f"{' (' + field_spec.expectedType + ')' if field_spec.expectedType else ''}\n"
        f"{field_spec.description}\n\n"
        f"Accessibility snapshot:\n{request.a11ySnapshot}"
    )
    messages.append({"role": "user", "content": user_content})
    return messages


def _to_response(call: ToolCall) -> AgentStepResponse:
    parameters = _TOOL_PARAMETERS.get(call.name)
    if parameters is None:
        raise HTTPException(status_code=502, detail=f"unknown tool: {call.name!r}")
    try:
        jsonschema.validate(call.arguments, parameters)
    except jsonschema.ValidationError as err:
        raise HTTPException(
            status_code=502, detail=f"invalid arguments for tool {call.name!r}: {err.message}"
        ) from err
    return AgentStepResponse.model_validate({"tool": call.name, **call.arguments})


@router.post("/agent/step", response_model=AgentStepResponse)
async def agent_step(
    request: AgentStepRequest,
    provider: LLMProvider = Depends(get_provider),  # noqa: B008 (FastAPI DI convention)
) -> AgentStepResponse:
    call = await provider.tool_step(BROWSER_TOOLS, _build_messages(request))
    return _to_response(call)
