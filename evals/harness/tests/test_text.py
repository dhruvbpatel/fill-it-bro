from fib_evals.text import normalise, token_set_ratio


def test_normalise_matches_core_examples() -> None:
    # Same cases as packages/core/src/text/similarity.test.ts.
    assert normalise("  Goldman   Sachs, Inc.! ") == "goldman sachs, inc."
    assert normalise("12/31/2026 - Due") == "12/31/2026 - due"
    assert normalise("Wells (Fargo) & Co.") == "wells fargo co."


def test_token_set_ratio_perfect_and_partial() -> None:
    assert token_set_ratio("goldman sachs", "goldman sachs") == 1.0
    assert token_set_ratio("goldman sachs incorporated", "incorporated sachs goldman") == 1.0
    # One side's tokens are a subset of the other's -> perfect score, like the TS core.
    assert token_set_ratio("goldman sachs", "goldman sachs asset mgmt") == 1.0
    assert 0.0 < token_set_ratio("goldman sachs", "goldman stanley") < 1.0
    assert token_set_ratio("goldman sachs", "morgan stanley") < 0.9
