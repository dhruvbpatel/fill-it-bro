import { describe, expect, it } from 'vitest';
import { normaliseDate } from './date.js';

describe('normaliseDate', () => {
  it('accepts ISO without a profile', () => {
    expect(normaliseDate('2026-09-30')).toBe('2026-09-30');
    expect(normaliseDate(' 2026-9-3 ')).toBe('2026-09-03');
  });

  it('accepts D Month YYYY without a profile', () => {
    expect(normaliseDate('30 September 2026')).toBe('2026-09-30');
    expect(normaliseDate('1 Oct 2026')).toBe('2026-10-01');
    expect(normaliseDate('05 March 2025')).toBe('2025-03-05');
  });

  it('parses DD/MM/YYYY per profile.dateFormat', () => {
    expect(normaliseDate('30/09/2026', 'DD/MM/YYYY')).toBe('2026-09-30');
    expect(normaliseDate('5/1/2026', 'DD/MM/YYYY')).toBe('2026-01-05');
  });

  it('parses MM/DD/YYYY per profile.dateFormat', () => {
    expect(normaliseDate('09/30/2026', 'MM/DD/YYYY')).toBe('2026-09-30');
  });

  it('rejects slash dates without a profile (default ISO)', () => {
    expect(() => normaliseDate('30/09/2026')).toThrow(/cannot parse/);
  });

  it('rejects unparseable input and invalid calendar dates', () => {
    expect(() => normaliseDate('not a date')).toThrow(/cannot parse/);
    expect(() => normaliseDate('2026-02-30')).toThrow(/invalid day/);
    expect(() => normaliseDate('31/02/2026', 'DD/MM/YYYY')).toThrow(/invalid day/);
    expect(() => normaliseDate('13/2026', 'DD/MM/YYYY')).toThrow(/cannot parse/);
  });
});
