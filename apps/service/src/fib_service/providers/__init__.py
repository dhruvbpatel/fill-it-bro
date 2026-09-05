"""Pluggable LLM providers; selected by the PROVIDER setting."""

from ..settings import get_settings
from .base import LLMProvider, ToolCall
from .fake_provider import FakeProvider
from .openai_provider import OpenAIProvider

__all__ = ["FakeProvider", "LLMProvider", "OpenAIProvider", "ToolCall", "get_provider"]


def get_provider() -> LLMProvider:
    settings = get_settings()
    if settings.PROVIDER == "openai":
        return OpenAIProvider(
            base_url=settings.GATEWAY_BASE_URL,
            api_key=settings.GATEWAY_API_KEY,
            model=settings.MODEL,
        )
    return FakeProvider()
