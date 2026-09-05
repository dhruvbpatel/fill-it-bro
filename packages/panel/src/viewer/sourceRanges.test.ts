import { describe, expect, it } from 'vitest';
import type { DocumentSource, ManifestEntry } from '@fib/contracts';
import { sourceRanges } from './sourceRanges.js';

const sources: DocumentSource[] = [
  { sourceId: 'body', kind: 'emailBody', name: 'sample.msg', mime: 'message/rfc822' },
  { sourceId: 'att-1', kind: 'attachment', name: 'attachment 1', mime: 'application/pdf' },
  { sourceId: 'att-2', kind: 'attachment', name: 'attachment 2', mime: 'image/png' },
];

// Body (page 1), attachment 1 (pages 2–3), attachment 2 (page 4).
const manifest: ManifestEntry[] = [
  { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
  { mergedPage: 2, sourceId: 'att-1', sourcePage: 1 },
  { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
  { mergedPage: 4, sourceId: 'att-2', sourcePage: 1 },
];

describe('sourceRanges', () => {
  it('derives one entry per source with its merged page range', () => {
    expect(sourceRanges(manifest, sources)).toEqual([
      { sourceId: 'body', label: 'sample.msg', range: '1', from: 1, to: 1 },
      { sourceId: 'att-1', label: 'sample.msg › attachment 1', range: '2–3', from: 2, to: 3 },
      { sourceId: 'att-2', label: 'sample.msg › attachment 2', range: '4', from: 4, to: 4 },
    ]);
  });

  it('falls back to the raw sourceId when the source is unknown', () => {
    const manifest2: ManifestEntry[] = [{ mergedPage: 1, sourceId: 'ghost', sourcePage: 1 }];
    expect(sourceRanges(manifest2, sources)).toEqual([
      { sourceId: 'ghost', label: 'ghost', range: '1', from: 1, to: 1 },
    ]);
  });
});
