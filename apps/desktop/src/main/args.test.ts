import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses --dealId= and --formId= flags', () => {
    expect(parseArgs(['--dealId=1', '--formId=fixtureDeal'])).toEqual({
      dealId: '1',
      formId: 'fixtureDeal',
    });
  });

  it('parses positional args for the deploy pipeline (fib.exe <dealId> <formId>)', () => {
    expect(parseArgs(['1', 'fixtureDeal'])).toEqual({ dealId: '1', formId: 'fixtureDeal' });
  });

  it('returns null when dealId is missing', () => {
    expect(parseArgs(['--formId=fixtureDeal'])).toBeNull();
  });

  it('returns null when formId is missing', () => {
    expect(parseArgs(['--dealId=1'])).toBeNull();
  });

  it('returns null for empty args', () => {
    expect(parseArgs([])).toBeNull();
  });
});
