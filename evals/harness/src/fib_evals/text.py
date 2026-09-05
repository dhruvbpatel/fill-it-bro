"""Text normalisation and fuzzy matching, ported from @fib/core text/similarity.ts."""

import re

_STRIP_RE = re.compile(r"[^a-z0-9\s.,\-/]")
_WS_RE = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation except `.`, `,`, `-`, `/`."""
    return _WS_RE.sub(" ", _STRIP_RE.sub("", text.lower())).strip()


def token_set_ratio(a: str, b: str) -> float:
    """rapidfuzz-style token-set ratio in 0..1, robust to word order and extra/missing tokens."""
    tokens_a = {token for token in a.split(" ") if token}
    tokens_b = {token for token in b.split(" ") if token}

    intersection = sorted(tokens_a & tokens_b)
    only_a = sorted(tokens_a - tokens_b)
    only_b = sorted(tokens_b - tokens_a)

    intersection_text = " ".join(intersection)
    combined_a = " ".join(part for part in (intersection_text, " ".join(only_a)) if part)
    combined_b = " ".join(part for part in (intersection_text, " ".join(only_b)) if part)

    return max(
        _ratio(intersection_text, combined_a),
        _ratio(intersection_text, combined_b),
        _ratio(combined_a, combined_b),
    )


def _ratio(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    return 2 * _lcs_length(a, b) / (len(a) + len(b))


def _lcs_length(a: str, b: str) -> int:
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i][j] = (
                dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1][j], dp[i][j - 1])
            )
    return dp[len(a)][len(b)]
