from types import SimpleNamespace

from fib_evals.compare import (
    citation_valid,
    display_str,
    exact_match,
    fuzzy_match,
    normalised_match,
)


def test_display_str() -> None:
    assert display_str(True) == "true"
    assert display_str(False) == "false"
    assert display_str(1500000.0) == "1500000"
    assert display_str(1500000) == "1500000"
    assert display_str("USD") == "USD"


def test_exact_match_is_type_aware() -> None:
    assert exact_match(1500000.0, 1500000)
    assert not exact_match(1500000, "1500000")
    assert exact_match("USD", "USD")
    assert not exact_match("usd", "USD")
    assert exact_match(True, True)
    assert not exact_match(True, "true")
    assert not exact_match(False, True)


def test_normalised_match() -> None:
    assert normalised_match("Wells (Fargo) & Co.", "wells fargo co.")
    assert not normalised_match("Goldman Sachs", "Morgan Stanley")


def test_fuzzy_match_threshold() -> None:
    assert fuzzy_match("Goldman Sachs Incorporated", "Goldman Sachs")
    assert not fuzzy_match("Goldman Sachs", "Morgan Stanley")


def _field(value, item_ids: list[str]):
    return SimpleNamespace(
        value=value, citations=[SimpleNamespace(itemIds=item_ids)]
    )


def test_citation_valid_requires_ids_and_containment() -> None:
    items = {
        "p1i0": SimpleNamespace(text="Issuer: Goldman Sachs Incorporated"),
        "p1i1": SimpleNamespace(text="Deal Amount: 1500000"),
    }

    assert citation_valid(_field("Goldman Sachs Incorporated", ["p1i0"]), items)
    assert citation_valid(_field(1500000.0, ["p1i1"]), items)
    assert citation_valid(_field(None, []), items)

    assert not citation_valid(_field("Goldman Sachs Incorporated", ["p9i9"]), items)
    assert not citation_valid(_field("Morgan Stanley", ["p1i0"]), items)
    assert not citation_valid(
        _field("Goldman Sachs Incorporated", ["p1i0", "missing"]), items
    )
