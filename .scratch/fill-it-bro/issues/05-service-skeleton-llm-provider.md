# 05: Service skeleton + LLMProvider

**What to build:** A running FastAPI service with health check, settings from environment, and a pluggable LLM provider where the OpenAI implementation talks to the internal gateway and a fake implementation serves tests.

**Blocked by:** 02 (Contracts + codegen)

**Status:** ready-for-agent

## Read first
- PLAN.md §7 (LLMProvider protocol), §12 security.

## Do exactly this
- Layout: `apps/service/src/fib_service/{main.py, settings.py, providers/{base.py, openai_provider.py, fake_provider.py}, routers/health.py}`. Entry point script `fib-service` → `uvicorn fib_service.main:app --port 8787`.
- `settings.py` (pydantic-settings): `GATEWAY_BASE_URL: str`, `GATEWAY_API_KEY: str`, `MODEL: str = "gpt-4o"`, `PROVIDER: Literal["openai","fake"] = "openai"`, `DUMP_EXTRACTION_DIR: str | None = None`, `RUN_LOG_PATH: str = "./runs.jsonl"`.
- `providers/base.py`:
  ```python
  class ToolCall(BaseModel): name: str; arguments: dict
  class LLMProvider(Protocol):
      async def structured(self, schema: dict, messages: list[dict]) -> dict: ...
      async def tool_step(self, tools: list[dict], messages: list[dict]) -> ToolCall: ...
  ```
- `openai_provider.py`: `AsyncOpenAI(base_url=GATEWAY_BASE_URL, api_key=GATEWAY_API_KEY)`. `structured` uses Responses API with `text={"format": {"type": "json_schema", "name": schema["title"], "schema": schema, "strict": True}}`; on HTTP 4xx from that call, retry once via `chat.completions` with `response_format={"type":"json_object"}` and the schema pasted into the system message; validate result with `jsonschema`. `tool_step` uses Responses API `tools=` and returns the first function call.
- `fake_provider.py`: loads `apps/service/tests/fixtures/<schema title>.json` and returns it; `tool_step` pops from a configurable queue.
- `get_provider()` dependency chosen by `PROVIDER`.
- `/healthz` → `{"ok": true, "provider": "<name>"}`.

## Acceptance criteria
- [ ] `PROVIDER=fake uv run fib-service` serves `/healthz`.
- [ ] pytest: `structured()` on FakeProvider returns the fixture; OpenAIProvider fallback path is unit-tested with a mocked client raising a 400 on Responses.
- [ ] No secret is read from anywhere except environment variables.
