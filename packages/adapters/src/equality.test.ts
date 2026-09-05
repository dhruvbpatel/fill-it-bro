import { describe, expect, it } from 'vitest';
import { valuesEqual } from './equality.js';

describe('valuesEqual', () => {
  it('numbers: strips thousands separators and currency symbols', () => {
    expect(valuesEqual('text', '1250000', '1250000')).toBe(true);
    expect(valuesEqual('text', '1,250,000', '1250000')).toBe(true);
    expect(valuesEqual('text', '$1,250,000.50', '1250000.5')).toBe(true);
    expect(valuesEqual('text', '€1.250,000', '1250000')).toBe(false); // dot-grouping not a number tier match
    expect(valuesEqual('text', '1,250,000', '1,250,001')).toBe(false);
  });

  it('dates: ISO compare', () => {
    expect(valuesEqual('date', '2026-09-30', '2026-09-30')).toBe(true);
    expect(valuesEqual('date', '2026-09-30', '2026-09-29')).toBe(false);
    expect(valuesEqual('date', '30/09/2026', '2026-09-30')).toBe(false); // non-ISO -> string tier
  });

  it('strings: trim + collapse spaces + case-insensitive', () => {
    expect(valuesEqual('select', '  Goldman   Sachs ', 'goldman sachs')).toBe(true);
    expect(valuesEqual('text', 'USD', 'usd')).toBe(true);
    expect(valuesEqual('text', 'abc', 'abd')).toBe(false);
  });

  it('falls back to string comparison when only one side is numeric', () => {
    expect(valuesEqual('text', '1250000', '1250000 EUR')).toBe(false);
  });
});
