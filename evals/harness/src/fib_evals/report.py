"""Markdown + JSON report rendering for eval runs."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .compare import FieldStats

MAIN_GROUP = "main"


@dataclass
class FormStats:
    fields: dict[str, FieldStats] = field(default_factory=dict)
    groups: dict[str, dict[str, FieldStats]] = field(default_factory=dict)

    def all_stats(self) -> list[tuple[str, str, FieldStats]]:
        """(groupId, fieldId, stats) for every tracked field; main-group fields first."""
        rows = [(MAIN_GROUP, field_id, stats) for field_id, stats in self.fields.items()]
        for group_id, group_fields in self.groups.items():
            rows.extend((group_id, field_id, stats) for field_id, stats in group_fields.items())
        return rows

    def totals(self) -> FieldStats:
        total = FieldStats()
        for _, _, stats in self.all_stats():
            total.accumulate(stats)
        return total

    def accuracy(self) -> float:
        return self.totals().accuracy()


@dataclass
class EvalRun:
    golden_dir: str
    provider: str
    min_accuracy: float
    forms: dict[str, FormStats] = field(default_factory=dict)

    def overall(self) -> FieldStats:
        total = FieldStats()
        for form in self.forms.values():
            total.accumulate(form.totals())
        return total

    def accuracy(self) -> float:
        return self.overall().accuracy()

    def passed(self) -> bool:
        return self.accuracy() >= self.min_accuracy


def _pct(hits: int, n: int) -> str:
    return f"{100.0 * hits / n:.1f}" if n else "n/a"


def _pct_value(hits: int, n: int) -> float | None:
    return round(100.0 * hits / n, 1) if n else None


def _summary(stats: FieldStats) -> dict:
    return {
        "n": stats.n,
        "exactPct": _pct_value(stats.exact, stats.n),
        "normalisedPct": _pct_value(stats.normalised, stats.n),
        "fuzzyPct": _pct_value(stats.fuzzy, stats.n),
        "citationValidPct": _pct_value(stats.citation_valid, stats.citation_n),
    }


def _field_label(group: str, field_id: str) -> str:
    return field_id if group == MAIN_GROUP else f"{group}.{field_id}"


def _field_entry(group: str, field_id: str, stats: FieldStats) -> dict:
    return {
        "field": _field_label(group, field_id),
        "group": group,
        **_summary(stats),
        "accuracy": round(stats.accuracy(), 4),
    }


def render_markdown(run: EvalRun) -> str:
    overall = run.overall()
    verdict = "PASS" if run.passed() else "FAIL"
    lines = [
        "# Extraction eval report",
        "",
        f"- Golden set: `{run.golden_dir}`",
        f"- Provider: `{run.provider}`",
        f"- Min accuracy: {run.min_accuracy}",
        f"- Generated: {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        (
            f"Overall accuracy: {_pct(overall.normalised, overall.n)}% "
            f"({overall.normalised}/{overall.n}) — {verdict}"
        ),
        "",
    ]
    for form_id, form in run.forms.items():
        totals = form.totals()
        group_ids = [MAIN_GROUP, *form.groups]
        form_verdict = "PASS" if form.accuracy() >= run.min_accuracy else "FAIL"
        lines.extend(
            [
                f"## {form_id}",
                "",
                (
                    f"Accuracy: {_pct(totals.normalised, totals.n)}% "
                    f"({totals.normalised}/{totals.n}) — {form_verdict}"
                ),
                "",
                f"Groups: {', '.join(group_ids)}",
                "",
                "| field | n | exact % | normalised % | fuzzy % | citation-valid % |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for group_id, field_id, stats in form.all_stats():
            label = _field_label(group_id, field_id)
            lines.append(
                f"| {label} | {stats.n} | {_pct(stats.exact, stats.n)} "
                f"| {_pct(stats.normalised, stats.n)} | {_pct(stats.fuzzy, stats.n)} "
                f"| {_pct(stats.citation_valid, stats.citation_n)} |"
            )
        lines.append(
            f"| **overall** | {totals.n} | {_pct(totals.exact, totals.n)} "
            f"| {_pct(totals.normalised, totals.n)} | {_pct(totals.fuzzy, totals.n)} "
            f"| {_pct(totals.citation_valid, totals.citation_n)} |"
        )
        lines.append("")
    return "\n".join(lines)


def render_json(run: EvalRun) -> str:
    payload = {
        "generatedAtUtc": datetime.now(UTC).isoformat(timespec="seconds"),
        "goldenDir": run.golden_dir,
        "provider": run.provider,
        "minAccuracy": run.min_accuracy,
        "met": run.passed(),
        "accuracy": round(run.accuracy(), 4),
        "forms": {
            form_id: {
                "accuracy": round(form.accuracy(), 4),
                "fields": [_field_entry(g, f, s) for g, f, s in form.all_stats()],
                "groups": {
                    MAIN_GROUP: {fid: _summary(s) for fid, s in form.fields.items()},
                    **{
                        group_id: {fid: _summary(s) for fid, s in group_fields.items()}
                        for group_id, group_fields in form.groups.items()
                    },
                },
                "overall": _summary(form.totals()),
            }
            for form_id, form in run.forms.items()
        },
    }
    return json.dumps(payload, indent=2) + "\n"


def write_reports(run: EvalRun, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(render_markdown(run))
    (out_dir / "report.json").write_text(render_json(run))
