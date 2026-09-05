"""Loads per-form extraction configs and BA prompt overrides from `CONFIGS_DIR`."""

import json
from pathlib import Path

from .contracts.extraction_config_schema import ExtractionConfig, FieldDef
from .settings import get_settings

# apps/service/src/fib_service/config_loader.py -> apps/service; CONFIGS_DIR default
# "../../configs" is resolved from there, landing on the repo-root `configs/` dir.
_SERVICE_ROOT = Path(__file__).resolve().parents[2]


def _configs_dir() -> Path:
    return (_SERVICE_ROOT / get_settings().CONFIGS_DIR).resolve()


def _resolve_field(field: FieldDef, prompts_dir: Path) -> FieldDef:
    prompt_path = prompts_dir / f"{field.fieldId}.md"
    if prompt_path.exists():
        return field.model_copy(update={"description": prompt_path.read_text().strip()})
    return field


def load_extraction_config(form_id: str) -> ExtractionConfig:
    form_dir = _configs_dir() / "forms" / form_id
    raw = json.loads((form_dir / "extraction.json").read_text())
    config = ExtractionConfig.model_validate(raw)
    prompts_dir = form_dir / "prompts"
    config.fields = [_resolve_field(f, prompts_dir) for f in config.fields]
    for group in config.groups:
        group.fields = [_resolve_field(f, prompts_dir) for f in group.fields]
    return config
