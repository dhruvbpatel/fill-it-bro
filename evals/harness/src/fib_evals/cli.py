"""`uv run evals`: runs extraction in-process over a golden set and reports per-field accuracy."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from fib_service.providers import FakeProvider, OpenAIProvider
from fib_service.routers.extract import extract
from fib_service.settings import get_settings

from .compare import FieldStats, citation_valid, compare_value
from .golden import GoldenCase, discover_cases, items_by_id, to_request
from .report import EvalRun, FormStats, write_reports


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="evals",
        description="Run extraction over a golden set and report per-field accuracy.",
    )
    parser.add_argument("--forms", default="configs/forms", help="Path to the configs/forms dir")
    parser.add_argument(
        "--golden", required=True, help="Golden set dir: <dir>/<formId>/<case>/documentSet.json"
    )
    parser.add_argument("--provider", choices=["fake", "openai"], default="fake")
    parser.add_argument("--out", default="evals/out", help="Dir for report.md and report.json")
    parser.add_argument(
        "--min-accuracy", type=float, default=0.0, help="Exit 1 when accuracy is below this"
    )
    return parser.parse_args(argv)


def build_provider(name: str, case_id: str):
    if name == "fake":
        # Canned fixtures are keyed by schema title + case (apps/service/tests/fixtures).
        return FakeProvider(case=case_id)
    settings = get_settings()
    return OpenAIProvider(
        base_url=settings.GATEWAY_BASE_URL,
        api_key=settings.GATEWAY_API_KEY,
        model=settings.MODEL,
    )


async def run_case(case: GoldenCase, provider_name: str, form_stats: FormStats) -> None:
    provider = build_provider(provider_name, case.case_id)
    request = to_request(case.form_id, case.document_set)
    result = await extract(request, provider=provider)
    doc_items = items_by_id(case.document_set)

    for field_id, expected_value in case.expected.get("fields", {}).items():
        stats = form_stats.fields.setdefault(field_id, FieldStats())
        extracted = [f for f in result.fields if f.fieldId == field_id]
        if not extracted:
            stats.add(None, False)
            stats.failures.append(f"{case.case_id}: field {field_id} not extracted")
            continue
        field = extracted[0]
        comparison = compare_value(field.value, expected_value)
        stats.add(comparison, citation_valid(field, doc_items) if field.citations else None)
        if not comparison.normalised:
            stats.failures.append(
                f"{case.case_id}: {field_id} expected {expected_value!r}, got {field.value!r}"
            )

    extracted_groups = {group.groupId: group for group in result.groups}
    for group_id, expected_rows in case.expected.get("groups", {}).items():
        group_fields = form_stats.groups.setdefault(group_id, {})
        rows = extracted_groups[group_id].rows if group_id in extracted_groups else []
        for row_index, expected_row in enumerate(expected_rows):
            row = rows[row_index] if row_index < len(rows) else None
            for col_id, expected_value in expected_row.items():
                stats = group_fields.setdefault(col_id, FieldStats())
                cell = next((c for c in row.cells if c.fieldId == col_id), None) if row else None
                if cell is None:
                    stats.add(None, False)
                    stats.failures.append(
                        f"{case.case_id}: {group_id}[{row_index}].{col_id} not extracted"
                    )
                    continue
                comparison = compare_value(cell.value, expected_value)
                stats.add(comparison, citation_valid(cell, doc_items) if cell.citations else None)
                if not comparison.normalised:
                    stats.failures.append(
                        f"{case.case_id}: {group_id}[{row_index}].{col_id} "
                        f"expected {expected_value!r}, got {cell.value!r}"
                    )


async def run(run_spec: EvalRun, cases: list[GoldenCase]) -> list[str]:
    for case in cases:
        form_stats = run_spec.forms.setdefault(case.form_id, FormStats())
        await run_case(case, run_spec.provider, form_stats)
    return [
        failure
        for form_stats in run_spec.forms.values()
        for _, _, stats in form_stats.all_stats()
        for failure in stats.failures
    ]


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    forms_dir = Path(args.forms).resolve()
    golden_dir = Path(args.golden).resolve()
    out_dir = Path(args.out).resolve()

    # load_extraction_config resolves CONFIGS_DIR from the service root; --forms points at
    # its `forms/` subdir, so point CONFIGS_DIR at the parent and drop the settings cache.
    os.environ["CONFIGS_DIR"] = str(forms_dir.parent)
    get_settings.cache_clear()

    run_spec = EvalRun(
        golden_dir=str(golden_dir), provider=args.provider, min_accuracy=args.min_accuracy
    )
    cases = discover_cases(golden_dir)
    if not cases:
        print(f"error: no golden cases found under {golden_dir}", file=sys.stderr)
        raise SystemExit(1)
    failures = asyncio.run(run(run_spec, cases))

    write_reports(run_spec, out_dir)
    for failure in failures:
        print(f"MISMATCH: {failure}", file=sys.stderr)
    verdict = "PASS" if run_spec.passed() else "FAIL"
    print(
        f"evals: {len(cases)} cases, accuracy {run_spec.accuracy():.4f} "
        f"(min {args.min_accuracy}) — {verdict}; reports in {out_dir}"
    )
    raise SystemExit(0 if run_spec.passed() else 1)


if __name__ == "__main__":
    main()
