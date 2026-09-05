import { tokenSetRatio } from '../text/similarity.js';

export interface MatchOptionResult {
  index: number | null;
  via: 'exact' | 'fuzzy' | 'llm' | 'none';
  confidence: number;
}

export type LlmOptionMatcher = (
  wanted: string,
  options: string[],
) => Promise<{ index: number | null; confidence: number }>;

const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'llc',
  'plc',
  'corp',
  'corporation',
  'co',
]);

const FUZZY_THRESHOLD = 0.9;

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

function endsWithLegalSuffix(normalised: string): boolean {
  const parts = tokens(normalised);
  return parts.length > 0 && LEGAL_SUFFIXES.has(parts[parts.length - 1] as string);
}

function stripLegalSuffixes(normalised: string): string {
  const parts = tokens(normalised);
  while (parts.length > 0 && LEGAL_SUFFIXES.has(parts[parts.length - 1] as string)) parts.pop();
  return parts.join(' ');
}

/**
 * Decide which dropdown option corresponds to `wanted`, tier by tier:
 * exact string; normalised (case/punctuation/whitespace + trailing legal
 * suffixes) exact and unique; token-set ratio >= 0.9 and unique best; the
 * `llm` callback; else none.
 *
 * Suffix-stripped equality only counts when both sides end in a legal suffix
 * (e.g. "inc." vs "Incorporated") or neither does: "Goldman Sachs" must fall
 * through to fuzzy/llm against "Goldman Sachs Incorporated" instead of
 * claiming an exact match once the option's suffix is dropped.
 */
export async function matchOption(
  wanted: string,
  options: string[],
  llm?: LlmOptionMatcher,
): Promise<MatchOptionResult> {
  const exactIndex = options.findIndex((option) => option === wanted);
  if (exactIndex !== -1) return { index: exactIndex, via: 'exact', confidence: 1 };

  if (options.length === 0) return { index: null, via: 'none', confidence: 0 };

  const wantedNorm = norm(wanted);
  if (wantedNorm !== '') {
    const wantedStripped = stripLegalSuffixes(wantedNorm);
    const wantedHadSuffix = endsWithLegalSuffix(wantedNorm);
    let matchIndex: number | null = null;
    let ambiguous = false;
    for (let i = 0; i < options.length; i++) {
      const optionNorm = norm(options[i] as string);
      if (optionNorm === '') continue;
      if (stripLegalSuffixes(optionNorm) !== wantedStripped) continue;
      if (endsWithLegalSuffix(optionNorm) !== wantedHadSuffix) continue;
      if (matchIndex === null) matchIndex = i;
      else {
        ambiguous = true;
        break;
      }
    }
    if (!ambiguous && matchIndex !== null) {
      return { index: matchIndex, via: 'exact', confidence: 1 };
    }
  }

  const scored = options
    .map((option, index) => ({ index, ratio: tokenSetRatio(wantedNorm, norm(option)) }))
    .filter((score) => score.ratio >= FUZZY_THRESHOLD)
    .sort((a, b) => b.ratio - a.ratio);
  if (scored.length > 0 && (scored.length === 1 || scored[0].ratio > scored[1].ratio)) {
    return { index: scored[0].index, via: 'fuzzy', confidence: scored[0].ratio };
  }

  if (llm) {
    const answer = await llm(wanted, options);
    if (answer && answer.index !== null && answer.index >= 0 && answer.index < options.length) {
      return { index: answer.index, via: 'llm', confidence: answer.confidence };
    }
  }
  return { index: null, via: 'none', confidence: 0 };
}
