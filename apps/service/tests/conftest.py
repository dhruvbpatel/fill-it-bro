import pytest
from fib_service.settings import get_settings


@pytest.fixture(autouse=True)
def fresh_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate tests from the host environment and reset the cached Settings."""
    for var in (
        "GATEWAY_BASE_URL",
        "GATEWAY_API_KEY",
        "MODEL",
        "PROVIDER",
        "DUMP_EXTRACTION_DIR",
        "RUN_LOG_PATH",
    ):
        monkeypatch.delenv(var, raising=False)
    get_settings.cache_clear()
