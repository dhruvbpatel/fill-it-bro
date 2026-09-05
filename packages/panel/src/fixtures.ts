import type { DocumentSet, FillEvent, ResolvedField } from '@fib/contracts';
import type { SessionSnapshot } from '@fib/core';

/**
 * Fixture data driving MemoryPanelApi in tests and browser dev
 * (`pnpm --filter panel dev`). Mirrors a .msg ingest: body + two attachments.
 */
export const fixtureDocumentSet: DocumentSet = {
  setId: 'set-1',
  sources: [
    { sourceId: 'body', kind: 'emailBody', name: 'sample.msg', mime: 'message/rfc822' },
    { sourceId: 'att-1', kind: 'attachment', name: 'attachment 1', mime: 'application/pdf' },
    { sourceId: 'att-2', kind: 'attachment', name: 'attachment 2', mime: 'image/png' },
  ],
  manifest: [
    { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
    { mergedPage: 2, sourceId: 'att-1', sourcePage: 1 },
    { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
    { mergedPage: 4, sourceId: 'att-2', sourcePage: 1 },
  ],
  pages: [
    {
      mergedPage: 1,
      width: 612,
      height: 792,
      items: [{ id: 'p1i0', text: 'Deal summary', x: 72, y: 72, w: 100, h: 12 }],
    },
    {
      mergedPage: 2,
      width: 612,
      height: 792,
      items: [{ id: 'p2i0', text: 'Term sheet', x: 72, y: 72, w: 90, h: 12 }],
    },
    {
      mergedPage: 3,
      width: 612,
      height: 792,
      items: [
        { id: 'p3i0', text: 'Issuer: Goldman Sachs Incorporated', x: 72, y: 90, w: 220, h: 12 },
      ],
    },
    {
      mergedPage: 4,
      width: 612,
      height: 792,
      items: [{ id: 'p4i0', text: 'Fee schedule', x: 72, y: 72, w: 96, h: 12 }],
    },
  ],
};

export const fixtureFields: ResolvedField[] = [
  {
    fieldId: 'issuerName',
    value: 'Goldman Sachs Incorporated',
    valueType: 'string',
    status: 'found',
    confidence: 0.97,
    sourceId: 'att-1',
    reason: null,
    citations: [
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 90, w: 220, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ],
  },
  {
    fieldId: 'dealAmount',
    value: '25000000',
    valueType: 'string',
    status: 'found',
    confidence: 0.88,
    sourceId: 'body',
    reason: null,
    citations: [
      {
        mergedPage: 1,
        boxes: [{ x: 72, y: 120, w: 120, h: 12 }],
        quote: '25,000,000',
        sourceId: 'body',
        sourcePage: 1,
      },
    ],
  },
  {
    fieldId: 'currency',
    value: 'USD',
    valueType: 'string',
    status: 'found',
    confidence: 0.95,
    sourceId: 'body',
    reason: null,
    citations: [
      {
        mergedPage: 1,
        boxes: [{ x: 72, y: 140, w: 60, h: 12 }],
        quote: 'USD',
        sourceId: 'body',
        sourcePage: 1,
      },
    ],
  },
  {
    fieldId: 'settlementDate',
    value: null,
    valueType: 'string',
    status: 'notFound',
    confidence: 0.9,
    sourceId: null,
    reason: 'not stated in the documents',
    citations: [],
  },
  {
    fieldId: 'parties[0].partyName',
    value: 'Goldman Sachs Incorporated',
    valueType: 'string',
    status: 'found',
    confidence: 0.97,
    sourceId: 'att-1',
    reason: null,
    citations: [
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 90, w: 220, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ],
  },
  {
    fieldId: 'parties[0].role',
    value: 'Issuer',
    valueType: 'string',
    status: 'found',
    confidence: 0.91,
    sourceId: 'att-1',
    reason: null,
    citations: [
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 110, w: 80, h: 12 }],
        quote: 'Issuer',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ],
  },
];

/** Events matching the executor convention: stepId contains the field id. */
export const fixtureFillEvents: FillEvent[] = [
  { stepId: 'fillField:issuerName', kind: 'stepStarted' },
  withVia({ stepId: 'fillField:issuerName', kind: 'stepVerified', via: 'exact' }),
  { stepId: 'fillField:dealAmount', kind: 'stepStarted' },
  { stepId: 'fillField:dealAmount', kind: 'stepRetrying', attempt: 1, reason: 'value mismatch' },
  withVia({ stepId: 'fillField:dealAmount', kind: 'stepVerified', via: 'fuzzy' }),
  { stepId: 'fillField:currency', kind: 'stepStarted' },
  withVia({ stepId: 'fillField:currency', kind: 'stepVerified', via: 'exact' }),
  { stepId: 'fillField:settlementDate', kind: 'stepSkipped', reason: 'no value' },
];

/** `via` rides on stepVerified events once the executor lands (ticket 19). */
type WithVia = FillEvent & { via?: 'exact' | 'fuzzy' | 'llm' | 'agent' };

function withVia(e: WithVia): FillEvent {
  return e;
}

export function fixtureSnapshot(): SessionSnapshot {
  return {
    state: 'review',
    dealId: '1',
    formId: 'fixtureDeal',
    documentSet: fixtureDocumentSet,
    fields: fixtureFields,
    fillEvents: fixtureFillEvents,
  };
}

/** Non-empty so dev `getMergedPdf` consumers get plausible bytes. */
export function fixtureMergedPdf(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}
