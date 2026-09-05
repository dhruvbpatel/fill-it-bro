"""Browser tool definitions for the /agent/step fallback loop.

Exactly one tool call from this set is returned per request. Tool names and
arguments mirror the `agent-step-response` contract schema.
"""

_REF = {"type": "string", "description": "Element ref from the accessibility snapshot, e.g. 'e12'."}


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


BROWSER_TOOLS: list[dict] = [
    _tool(
        "click",
        "Click the element with the given ref. Never click buttons named Submit, Save or Delete.",
        {"ref": _REF},
        ["ref"],
    ),
    _tool(
        "type",
        "Type text into an input element after clearing it.",
        {"ref": _REF, "text": {"type": "string", "description": "Text to type."}},
        ["ref", "text"],
    ),
    _tool(
        "press",
        "Press a keyboard key on the element, e.g. 'Enter'.",
        {"ref": _REF, "key": {"type": "string", "description": "Key name, e.g. 'Enter'."}},
        ["ref", "key"],
    ),
    _tool(
        "waitFor",
        "Wait until an element ref or text appears in the snapshot.",
        {
            "refOrText": {"type": "string", "description": "Element ref or text to wait for."},
            "ms": {"type": "integer", "description": "Timeout in milliseconds."},
        },
        ["refOrText", "ms"],
    ),
    _tool(
        "readValue",
        "Read the current value of an input element.",
        {"ref": _REF},
        ["ref"],
    ),
    _tool(
        "done",
        "Report success. Only call after readValue showed the expected value.",
        {"value": {"type": "string", "description": "The verified field value."}},
        ["value"],
    ),
    _tool(
        "giveUp",
        "Report failure. Only call after 3 unproductive actions.",
        {"reason": {"type": "string", "description": "Why the field could not be filled."}},
        ["reason"],
    ),
]
