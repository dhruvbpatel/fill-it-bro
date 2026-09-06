import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses --dealId= and --formId= flags', () => {
    expect(parseArgs(['--dealId=1', '--formId=fixtureDeal'])).toEqual({
      dealId: '1',
      formId: 'fixtureDeal',
      smoke: false,
    });
  });

  it('parses positional args for the deploy pipeline (fib.exe <dealId> <formId>)', () => {
    expect(parseArgs(['1', 'fixtureDeal'])).toEqual({
      dealId: '1',
      formId: 'fixtureDeal',
      smoke: false,
    });
  });

  it('sets smoke for --smoke (ticket 28 CI check)', () => {
    expect(parseArgs(['--dealId=1', '--formId=fixtureDeal', '--smoke'])).toEqual({
      dealId: '1',
      formId: 'fixtureDeal',
      smoke: true,
    });
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
