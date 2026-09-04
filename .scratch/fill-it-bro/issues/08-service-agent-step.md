# 08: Service /agent/step

**What to build:** `POST /agent/step` returns exactly one browser tool call for the fill fallback loop, given an accessibility snapshot, the field being filled, and the history of previous steps. Stateless.

**Blocked by:** 05 (Service skeleton + LLMProvider)

**Status:** ready-for-agent

## Do exactly this
- Tool definitions (OpenAI function schema) in `fib_service/tools/browser_tools.py`: `click{ref}`, `type{ref,text}`, `press{ref,key}`, `waitFor{ref|text, ms}`, `readValue{ref}`, `done{value}`, `giveUp{reason}`. Nothing else.
- System prompt `fib_service/prompts/agent_step.md`: goal is to set the given field to the given value on an Angular form; use only refs present in the snapshot; prefer typing into inputs and pressing Enter; never click buttons whose name matches Submit/Save/Delete; call `done` only after `readValue` shows the value; call `giveUp` after 3 unproductive actions.
- `routers/agent_step.py`: build messages (system, then `history[]` as prior assistant tool calls and user tool results, then current snapshot), call `provider.tool_step`, validate the tool name is in the set and arguments match, return `AgentStepResponse`. Unknown tool → HTTP 502 with detail.

## Acceptance criteria
- [ ] pytest: FakeProvider queue `[type, press, readValue, done]` yields four valid responses in order.
- [ ] Unknown tool from provider → 502.
- [ ] Response validates against `agent-step-response` schema.
