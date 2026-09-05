/** Lowercase, collapse whitespace, strip punctuation except `.`, `,`, `-`, `/`. */
export function normalise(text: string): string {
  const lowered = text.toLowerCase();
  const stripped = lowered.replace(/[^a-z0-9\s.,\-/]/g, '');
  return stripped.replace(/\s+/g, ' ').trim();
}

/** rapidfuzz-style token-set ratio: 0..1, robust to word order and extra/missing tokens. */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).sort();
  const onlyA = [...tokensA].filter((t) => !tokensB.has(t)).sort();
  const onlyB = [...tokensB].filter((t) => !tokensA.has(t)).sort();

  const sortedIntersection = intersection.join(' ');
  const combinedA = [sortedIntersection, onlyA.join(' ')].filter(Boolean).join(' ');
  const combinedB = [sortedIntersection, onlyB.join(' ')].filter(Boolean).join(' ');

  return Math.max(
    similarityRatio(sortedIntersection, combinedA),
    similarityRatio(sortedIntersection, combinedB),
    similarityRatio(combinedA, combinedB),
  );
}

function similarityRatio(a: string, b: string): number {
  if (a === '' && b === '') return 1;
  const lcs = longestCommonSubsequenceLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

function longestCommonSubsequenceLength(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
