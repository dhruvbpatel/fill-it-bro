"""Value comparison and citation validation, mirroring @fib/core's normalise/tokenSetRatio."""

from __future__ import annotations

from dataclasses import dataclass, field

from .text import normalise, token_set_ratio

__all__ = [
    "Comparison",
    "FieldStats",
    "citation_valid",
    "compare_value",
    "display_str",
    "exact_match",
    "fuzzy_match",
    "normalise",
    "normalised_match",
    "token_set_ratio",
]

CellValue = str | float | bool | None

_FUZZY_THRESHOLD = 0.9


def display_str(value: CellValue) -> str:
    """String form used for normalised/fuzzy comparison (None -> "", booleans as true/false)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def values_equal(actual: CellValue, expected: CellValue) -> bool:
    """Type-aware equality: booleans never equal numbers (Python would say True == 1)."""
    if isinstance(actual, bool) != isinstance(expected, bool):
        return False
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return float(actual) == float(expected)
    if type(actual) is not type(expected):
        return False
    return actual == expected


def exact_match(actual: CellValue, expected: CellValue) -> bool:
    return values_equal(actual, expected)


def normalised_match(actual: CellValue, expected: CellValue) -> bool:
    return normalise(display_str(actual)) == normalise(display_str(expected))


def fuzzy_match(actual: CellValue, expected: CellValue) -> bool:
    return (
        token_set_ratio(normalise(display_str(actual)), normalise(display_str(expected)))
        >= _FUZZY_THRESHOLD
    )


@dataclass(frozen=True)
class Comparison:
    exact: bool
    normalised: bool
    fuzzy: bool


def compare_value(actual: CellValue, expected: CellValue) -> Comparison:
    return Comparison(
        exact=exact_match(actual, expected),
        normalised=normalised_match(actual, expected),
        fuzzy=fuzzy_match(actual, expected),
    )


def _item_text(item: str | object) -> str:
    return item if isinstance(item, str) else str(item.text)


def citation_valid(cited: object, items_by_id: dict[str, str | object]) -> bool:
    """Every cited itemId exists in the document set and the joined item text contains the
    normalised value. A null/empty value makes no claim, so it is vacuously valid.
    `cited` is any object with `.value` and `.citations[].itemIds` (ExtractedField or test double)."""
    target = normalise(display_str(cited.value))
    if not target:
        return True
    for citation in cited.citations:
        item_ids = list(citation.itemIds)
        if not item_ids or any(item_id not in items_by_id for item_id in item_ids):
            return False
        joined = normalise(" ".join(_item_text(items_by_id[item_id]) for item_id in item_ids))
        if target not in joined:
            return False
    return True


@dataclass
class FieldStats:
    n: int = 0
    exact: int = 0
    normalised: int = 0
    fuzzy: int = 0
    citation_n: int = 0
    citation_valid: int = 0
    failures: list[str] = field(default_factory=list)

    def add(self, comparison: Comparison | None, citation_valid: bool | None) -> None:
        self.n += 1
        if comparison is not None:
            self.exact += int(comparison.exact)
            self.normalised += int(comparison.normalised)
            self.fuzzy += int(comparison.fuzzy)
        if citation_valid is not None:
            self.citation_n += 1
            self.citation_valid += int(citation_valid)

    def accumulate(self, other: FieldStats) -> None:
        self.n += other.n
        self.exact += other.exact
        self.normalised += other.normalised
        self.fuzzy += other.fuzzy
        self.citation_n += other.citation_n
        self.citation_valid += other.citation_valid

    @property
    def matched(self) -> int:
        return self.normalised

    def accuracy(self) -> float:
        return self.matched / self.n if self.n else 1.0
