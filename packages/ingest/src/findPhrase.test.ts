import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentSet, Page } from '@fib/contracts';
import { findPhrase } from './findPhrase.js';
import { ingest } from './ingest.js';
import { parsePdf } from './parse.js';

function makeSet(pages: Array<Array<[string, string]>>): DocumentSet {
  return {
    setId: 'set-test',
    sources: [{ sourceId: 'upload-1', kind: 'upload', name: 'test.pdf', mime: 'application/pdf' }],
    manifest: pages.map((_, i) => ({ mergedPage: i + 1, sourceId: 'upload-1', sourcePage: i + 1 })),
    pages: pages.map((items, i): Page => ({
      mergedPage: i + 1,
      width: 612,
      height: 792,
      items: items.map(([id, text], index) => ({
        id,
        text,
        x: 72,
        y: 100 + index * 14,
        w: 40 + text.length,
        h: 12,
      })),
    })),
  };
}

describe('findPhrase (real fixture)', () => {
  // LiteParse's first call loads a native module — slow on cold CI runners.
  it(
    "finds 'Goldman Sachs Incorporated' on page 1 with non-empty itemIds",
    { timeout: 30_000 },
    async () => {
      const set = await ingest([path.resolve(import.meta.dirname, '../fixtures/simple.pdf')], {
        parsePdf,
      });
      const matches = findPhrase(set, 'Goldman Sachs Incorporated');
      expect(matches).toHaveLength(1);
      expect(matches[0]?.mergedPage).toBe(1);
      expect(matches[0]?.itemIds.length).toBeGreaterThan(0);
    },
  );

  it("finds '1,250,000 USD' on page 2", { timeout: 30_000 }, async () => {
    const set = await ingest([path.resolve(import.meta.dirname, '../fixtures/simple.pdf')], {
      parsePdf,
    });
    const matches = findPhrase(set, '1,250,000 USD');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.mergedPage).toBe(2);
  });
});

describe('findPhrase (synthetic sets)', () => {
  it('stitches a phrase spread over consecutive items on the same page', () => {
    const set = makeSet([
      [
        ['p1i0', 'Issuer:'],
        ['p1i1', 'Goldman'],
        ['p1i2', 'Sachs'],
        ['p1i3', 'Incorporated'],
      ],
    ]);
    expect(findPhrase(set, 'goldman sachs incorporated')).toEqual([
      { mergedPage: 1, itemIds: ['p1i1', 'p1i2', 'p1i3'] },
    ]);
  });

  it('normalises case and whitespace on both sides', () => {
    const set = makeSet([[['p1i0', 'Amount:  1,250,000    USD']]]);
    expect(findPhrase(set, 'amount: 1,250,000 usd')).toEqual([
      { mergedPage: 1, itemIds: ['p1i0'] },
    ]);
  });

  it('excludes items that only contribute the joining space', () => {
    const set = makeSet([
      [
        ['p1i0', 'Issuer:'],
        ['p1i1', 'Goldman Sachs Incorporated'],
      ],
    ]);
    expect(findPhrase(set, 'Goldman Sachs Incorporated')).toEqual([
      { mergedPage: 1, itemIds: ['p1i1'] },
    ]);
  });

  it('never stitches across pages', () => {
    const set = makeSet([[['p1i0', 'end of page']], [['p2i0', 'start of next']]]);
    expect(findPhrase(set, 'end of page start of next')).toEqual([]);
  });

  it('returns every occurrence on a page', () => {
    const set = makeSet([
      [
        ['p1i0', 'fee USD 10'],
        ['p1i1', 'fee USD 20'],
      ],
    ]);
    expect(findPhrase(set, 'fee USD')).toEqual([
      { mergedPage: 1, itemIds: ['p1i0'] },
      { mergedPage: 1, itemIds: ['p1i1'] },
    ]);
  });

  it('returns [] when nothing matches and for empty phrases', () => {
    const set = makeSet([[['p1i0', 'Issuer: Goldman Sachs Incorporated']]]);
    expect(findPhrase(set, 'JPMorgan')).toEqual([]);
    expect(findPhrase(set, '')).toEqual([]);
    expect(findPhrase(set, '   ')).toEqual([]);
  });
});
