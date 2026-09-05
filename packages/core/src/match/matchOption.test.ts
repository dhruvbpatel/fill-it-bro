import { describe, expect, it, vi } from 'vitest';
import { matchOption } from './matchOption.js';

describe('matchOption tiers', () => {
  it('matches an exact string without calling the llm', async () => {
    const llm = vi.fn();
    await expect(matchOption('USD', ['EUR', 'USD'], llm)).resolves.toEqual({
      index: 1,
      via: 'exact',
      confidence: 1,
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it('matches after normalisation: case, punctuation, whitespace, legal suffix', async () => {
    const llm = vi.fn();
    await expect(
      matchOption('  GOLDMAN   SACHS,  INC. ', ['Wells Fargo', 'Goldman Sachs Incorporated'], llm),
    ).resolves.toEqual({ index: 1, via: 'exact', confidence: 1 });
    expect(llm).not.toHaveBeenCalled();
  });

  it('matches the acceptance-case "goldman sachs inc." against "Goldman Sachs Incorporated"', async () => {
    await expect(
      matchOption('goldman sachs inc.', ['Goldman Sachs Incorporated']),
    ).resolves.toEqual({ index: 0, via: 'exact', confidence: 1 });
  });

  it('does not exact-match by dropping the option suffix alone', async () => {
    const llm = vi.fn();
    await expect(
      matchOption('Goldman Sachs', ['Goldman Sachs Incorporated'], llm),
    ).resolves.toEqual({ index: 0, via: 'fuzzy', confidence: 1 });
    expect(llm).not.toHaveBeenCalled();
  });
});

describe('matchOption fuzzy tier', () => {
  it('returns the unique best option at ratio >= 0.9', async () => {
    const llm = vi.fn();
    const result = await matchOption('wells fargo', ['Citigroup', 'Wells Fargo Advisors'], llm);
    expect(result.via).toBe('fuzzy');
    expect(result.index).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(llm).not.toHaveBeenCalled();
  });

  it('falls through when the best ratio is tied', async () => {
    const llm = vi.fn().mockResolvedValue({ index: 1, confidence: 0.7 });
    const result = await matchOption('goldman sachs', ['Goldman Sachs A', 'Goldman Sachs B'], llm);
    expect(result).toEqual({ index: 1, via: 'llm', confidence: 0.7 });
  });

  it('consults the llm when no candidate reaches the threshold', async () => {
    const llm = vi.fn().mockResolvedValue({ index: null, confidence: 0 });
    await expect(matchOption('banana ltd', ['apple inc'], llm)).resolves.toEqual({
      index: null,
      via: 'none',
      confidence: 0,
    });
    expect(llm).toHaveBeenCalledExactlyOnceWith('banana ltd', ['apple inc']);
  });
});

describe('matchOption llm tier', () => {
  it('calls the llm with both fuzzy candidates for the canonical Goldman case', async () => {
    const options = ['Goldman Sachs Incorporated', 'Goldman Sachs Asset Mgmt'];
    const llm = vi.fn().mockResolvedValue({ index: 0, confidence: 0.8 });
    await expect(matchOption('Goldman Sachs', options, llm)).resolves.toEqual({
      index: 0,
      via: 'llm',
      confidence: 0.8,
    });
    expect(llm).toHaveBeenCalledExactlyOnceWith('Goldman Sachs', options);
  });

  it('returns none when no llm is provided', async () => {
    await expect(
      matchOption('Goldman Sachs', ['Goldman Sachs Incorporated', 'Goldman Sachs Asset Mgmt']),
    ).resolves.toEqual({ index: null, via: 'none', confidence: 0 });
  });

  it('returns none when the llm declines', async () => {
    const llm = vi.fn().mockResolvedValue({ index: null, confidence: 0 });
    await expect(
      matchOption('Goldman Sachs', ['Goldman Sachs Incorporated', 'Goldman Sachs Asset Mgmt'], llm),
    ).resolves.toEqual({ index: null, via: 'none', confidence: 0 });
  });

  it('returns none when the llm returns an out-of-range index', async () => {
    const llm = vi.fn().mockResolvedValue({ index: 5, confidence: 1 });
    await expect(
      matchOption('Goldman Sachs', ['Goldman Sachs Incorporated', 'Goldman Sachs Asset Mgmt'], llm),
    ).resolves.toEqual({ index: null, via: 'none', confidence: 0 });
  });
});

describe('matchOption uniqueness of the normalised tier', () => {
  it('does not fire when two options normalise to the same value', async () => {
    const llm = vi.fn().mockResolvedValue({ index: 1, confidence: 0.9 });
    const result = await matchOption(
      'goldman sachs inc.',
      ['Goldman Sachs Inc', 'Goldman Sachs Inc'],
      llm,
    );
    expect(result).toEqual({ index: 1, via: 'llm', confidence: 0.9 });
    expect(llm).toHaveBeenCalledExactlyOnceWith('goldman sachs inc.', [
      'Goldman Sachs Inc',
      'Goldman Sachs Inc',
    ]);
  });

  it('returns none for an empty option list', async () => {
    const llm = vi.fn();
    await expect(matchOption('USD', [], llm)).resolves.toEqual({
      index: null,
      via: 'none',
      confidence: 0,
    });
    expect(llm).not.toHaveBeenCalled();
  });
});
