"""Environment-driven settings; secrets come from the environment only."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", frozen=True)

    GATEWAY_BASE_URL: str = ""
    GATEWAY_API_KEY: str = ""
    MODEL: str = "gpt-4o"
    PROVIDER: Literal["openai", "fake"] = "openai"
    DUMP_EXTRACTION_DIR: str | None = None
    RUN_LOG_PATH: str = "./runs.jsonl"
    CONFIGS_DIR: str = "../../configs"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
