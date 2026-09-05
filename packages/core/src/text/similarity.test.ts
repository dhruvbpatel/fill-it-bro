import { describe, expect, it } from 'vitest';
import { normalise, tokenSetRatio } from './similarity.js';

describe('normalise', () => {
  it('lowercases, collapses whitespace, and strips punctuation except . , - /', () => {
    expect(normalise('  Goldman   Sachs, Inc.! ')).toBe('goldman sachs, inc.');
    expect(normalise('12/31/2026 - Due')).toBe('12/31/2026 - due');
    expect(normalise('Wells (Fargo) & Co.')).toBe('wells fargo co.');
  });
});

describe('tokenSetRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(tokenSetRatio('goldman sachs incorporated', 'goldman sachs incorporated')).toBe(1);
  });

  it('scores near-identical phrases with reordered/extra tokens highly', () => {
    const ratio = tokenSetRatio('goldman sachs', 'goldman sachs incorporated');
    expect(ratio).toBeGreaterThanOrEqual(0.9);
  });

  it('scores unrelated strings low', () => {
    const ratio = tokenSetRatio('goldman sachs incorporated', 'totally different phrase');
    expect(ratio).toBeLessThan(0.5);
  });
});
