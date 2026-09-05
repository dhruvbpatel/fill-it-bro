import { describe, expect, it } from 'vitest';
import type { DocumentSet, ExtractionResult } from '@fib/contracts';
import { resolve, type FindPhrase, type PhraseMatch } from './resolve.js';

const documentSet: DocumentSet = {
  setId: 'set-1',
  sources: [
    { sourceId: 'body', kind: 'emailBody', name: 'email.eml', mime: 'text/html' },
    { sourceId: 'att-1', kind: 'attachment', name: 'term-sheet.pdf', mime: 'application/pdf' },
  ],
  manifest: [
    { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
    { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
  ],
  pages: [
    {
      mergedPage: 1,
      width: 612,
      height: 792,
      items: [{ id: 'p1i0', text: 'Dear team,', x: 10, y: 10, w: 50, h: 12 }],
    },
    {
      mergedPage: 3,
      width: 612,
      height: 792,
      items: [
        { id: 'p3i17', text: 'Goldman Sachs Incorporated', x: 72, y: 144.5, w: 180.25, h: 12 },
      ],
    },
  ],
};

function extraction(overrides: Partial<ExtractionResult['fields'][number]>): ExtractionResult {
  return {
    runId: 'run-1',
    fields: [
      {
        fieldId: 'issuerName',
        value: 'Goldman Sachs Incorporated',
        valueType: 'string',
        status: 'found',
        confidence: 0.95,
        sourceId: 'att-1',
        citations: [{ itemIds: ['p3i17'], quote: 'Goldman Sachs Incorporated' }],
        reason: null,
        ...overrides,
      },
    ],
    groups: [],
  };
}

const noPhrase: FindPhrase = () => [];

describe('resolve', () => {
  it('good ids + matching quote: boxes equal item rects, status unchanged', () => {
    const result = extraction({});
    const [resolved] = resolve(documentSet, result, noPhrase);

    expect(resolved.status).toBe('found');
    expect(resolved.confidence).toBe(0.95);
    expect(resolved.citations).toEqual([
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 144.5, w: 180.25, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ]);
  });

  it('bad ids + findable quote: boxes come from findPhrase, status unchanged', () => {
    const result = extraction({
      citations: [{ itemIds: ['bogus-id'], quote: 'Goldman Sachs Incorporated' }],
    });
    const findPhrase: FindPhrase = (_set, phrase): PhraseMatch[] =>
      phrase === 'Goldman Sachs Incorporated' ? [{ mergedPage: 3, itemIds: ['p3i17'] }] : [];

    const [resolved] = resolve(documentSet, result, findPhrase);

    expect(resolved.status).toBe('found');
    expect(resolved.confidence).toBe(0.95);
    expect(resolved.citations).toEqual([
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 144.5, w: 180.25, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ]);
  });

  it('bad ids + unfindable quote: no boxes, unverifiedCitation, confidence capped at 0.4', () => {
    const result = extraction({
      citations: [{ itemIds: ['bogus-id'], quote: 'Nonexistent Phrase' }],
    });

    const [resolved] = resolve(documentSet, result, noPhrase);

    expect(resolved.citations).toEqual([]);
    expect(resolved.status).toBe('unverifiedCitation');
    expect(resolved.confidence).toBeLessThanOrEqual(0.4);
  });

  it('attaches sourceId/sourcePage from manifest where mergedPage 3 = att-1 page 2', () => {
    const [resolved] = resolve(documentSet, extraction({}), noPhrase);

    expect(resolved.citations[0].sourceId).toBe('att-1');
    expect(resolved.citations[0].sourcePage).toBe(2);
  });

  it('passes notFound fields through unchanged with empty citations', () => {
    const result: ExtractionResult = {
      runId: 'run-1',
      fields: [
        {
          fieldId: 'missingField',
          value: null,
          valueType: 'string',
          status: 'notFound',
          confidence: 0,
          sourceId: null,
          citations: [],
          reason: 'not present in documents',
        },
      ],
      groups: [],
    };

    const [resolved] = resolve(documentSet, result, noPhrase);

    expect(resolved).toEqual({
      fieldId: 'missingField',
      value: null,
      valueType: 'string',
      status: 'notFound',
      confidence: 0,
      sourceId: null,
      reason: 'not present in documents',
      citations: [],
    });
  });

  it('resolves group row cells the same way as top-level fields', () => {
    const result: ExtractionResult = {
      runId: 'run-1',
      fields: [],
      groups: [
        {
          groupId: 'parties',
          rows: [
            {
              cells: [
                {
                  fieldId: 'partyName',
                  value: 'Goldman Sachs Incorporated',
                  valueType: 'string',
                  status: 'found',
                  confidence: 0.9,
                  sourceId: 'att-1',
                  citations: [{ itemIds: ['p3i17'], quote: 'Goldman Sachs Incorporated' }],
                  reason: null,
                },
              ],
            },
          ],
        },
      ],
    };

    const [resolved] = resolve(documentSet, result, noPhrase);

    expect(resolved.fieldId).toBe('partyName');
    expect(resolved.status).toBe('found');
    expect(resolved.citations[0].boxes).toEqual([{ x: 72, y: 144.5, w: 180.25, h: 12 }]);
  });
});
