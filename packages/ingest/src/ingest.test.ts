import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Page } from '@fib/contracts';
import { ingest, UnsupportedInput } from './ingest.js';
import type { IngestDeps } from './ingest.js';
import { parsePdf } from './parse.js';

const realDeps: IngestDeps = { parsePdf };
const simplePdf = path.resolve(import.meta.dirname, '../fixtures/simple.pdf');

describe('ingest (single PDF)', () => {
  it('returns a 2-page DocumentSet where every item has positive width and height', async () => {
    const set = await ingest([simplePdf], realDeps);

    expect(set.pages).toHaveLength(2);
    expect(set.setId).toMatch(/^set-/);
    expect(set.mergedPdf.length).toBeGreaterThan(0);
    expect(set.sources).toEqual([
      { sourceId: 'upload-1', kind: 'upload', name: 'simple.pdf', mime: 'application/pdf' },
    ]);
    expect(set.manifest).toEqual([
      { mergedPage: 1, sourceId: 'upload-1', sourcePage: 1 },
      { mergedPage: 2, sourceId: 'upload-1', sourcePage: 2 },
    ]);
    for (const page of set.pages) {
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      page.items.forEach((item, index) => {
        expect(item.id).toBe(`p${page.mergedPage}i${index}`);
        expect(item.w).toBeGreaterThan(0);
        expect(item.h).toBeGreaterThan(0);
      });
    }
  });

  it('carries the source bytes as mergedPdf', async () => {
    const set = await ingest([simplePdf], realDeps);
    expect(set.mergedPdf).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...set.mergedPdf.slice(0, 5))).toBe('%PDF-');
  });

  it('throws UnsupportedInput for non-pdf extensions', async () => {
    await expect(ingest(['fixtures/notes.msg'], realDeps)).rejects.toBeInstanceOf(UnsupportedInput);
    await expect(ingest(['fixtures/notes.msg'], realDeps)).rejects.toThrow(
      /only \.pdf is supported/,
    );
  });

  it('throws UnsupportedInput for anything other than exactly one file', async () => {
    await expect(ingest([], realDeps)).rejects.toBeInstanceOf(UnsupportedInput);
    await expect(ingest([simplePdf, simplePdf], realDeps)).rejects.toBeInstanceOf(UnsupportedInput);
  });

  it('uses pages produced by the injected parsePdf dep', async () => {
    const pages: Page[] = [
      {
        mergedPage: 1,
        width: 612,
        height: 792,
        items: [{ id: 'p1i0', text: 'sentinel', x: 72, y: 81, w: 40, h: 12 }],
      },
    ];
    const fake: IngestDeps = { parsePdf: async () => pages };
    const set = await ingest([simplePdf], fake);
    expect(set.pages).toEqual(pages);
    expect(set.manifest).toEqual([{ mergedPage: 1, sourceId: 'upload-1', sourcePage: 1 }]);
  });
});
