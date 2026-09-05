import { describe, expect, it } from 'vitest';
import type { FillEvent, ResolvedField } from '@fib/contracts';
import { deriveStatus, eventsForField, sortFields } from './deriveStatus';

function ev(kind: FillEvent['kind'], stepId: string, extra: object = {}): FillEvent {
  return { stepId, kind, ...extra } as FillEvent;
}

function field(overrides: Partial<ResolvedField> = {}): ResolvedField {
  return {
    fieldId: 'issuerName',
    value: 'x',
    valueType: 'string',
    status: 'found',
    confidence: 0.95,
    sourceId: 'body',
    reason: null,
    citations: [],
    ...overrides,
  };
}

describe('eventsForField', () => {
  it('matches events whose stepId ends with the fieldId', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepStarted', 'fillField:dealAmount'),
      ev('stepVerified', 'fillField:issuerName'),
    ];
    expect(eventsForField(events, 'issuerName')).toEqual([events[0], events[2]]);
  });

  it('matches grid cell events by their full cell id', () => {
    const events = [ev('stepVerified', 'fillCell:parties[0].partyName')];
    expect(eventsForField(events, 'parties[0].partyName')).toEqual(events);
  });

  it('does not match field ids embedded inside longer names', () => {
    const events = [ev('stepStarted', 'fillField:partyName')];
    expect(eventsForField(events, 'name')).toEqual([]);
    expect(eventsForField(events, 'partyName')).toEqual(events);
  });
});

describe('deriveStatus', () => {
  it('is failed when the last event for the field is stepFailed', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName'),
      ev('stepRetrying', 'fillField:issuerName', { attempt: 2, reason: 'mismatch' }),
      ev('stepFailed', 'fillField:issuerName', { reason: 'boom' }),
    ];
    expect(deriveStatus(field(), events)).toBe('failed');
  });

  it('ignores stepFailed events belonging to other fields', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName'),
      ev('stepFailed', 'fillField:dealAmount'),
    ];
    expect(deriveStatus(field(), events)).toBe('verified');
  });

  it('is filledByAgent when verified via agent', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepFallback', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName', { via: 'agent' }),
    ];
    expect(deriveStatus(field(), events)).toBe('filledByAgent');
  });

  it('is needsReview when verified via fuzzy', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName', { via: 'fuzzy' }),
    ];
    expect(deriveStatus(field(), events)).toBe('needsReview');
  });

  it('is needsReview when verified via llm', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName', { via: 'llm' }),
    ];
    expect(deriveStatus(field(), events)).toBe('needsReview');
  });

  it('is needsReview when the citation is unverified', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName'),
    ];
    expect(deriveStatus(field({ status: 'unverifiedCitation', confidence: 0.9 }), events)).toBe(
      'needsReview',
    );
  });

  it('is lowConfidence when confidence < 0.6', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName'),
    ];
    expect(deriveStatus(field({ confidence: 0.59 }), events)).toBe('lowConfidence');
  });

  it('is notFound when the extraction found nothing', () => {
    const events = [ev('stepSkipped', 'fillField:issuerName', { reason: 'no value' })];
    expect(deriveStatus(field({ status: 'notFound', confidence: 0.9 }), events)).toBe('notFound');
  });

  it('is verified when a stepVerified exists and nothing else applies', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName'),
    ];
    expect(deriveStatus(field(), events)).toBe('verified');
  });

  it('is pending when there are no events for the field', () => {
    expect(deriveStatus(field(), [])).toBe('pending');
  });

  it('prefers failure over every other signal', () => {
    const events = [
      ev('stepStarted', 'fillField:issuerName'),
      ev('stepVerified', 'fillField:issuerName', { via: 'agent' }),
      ev('stepFailed', 'fillField:issuerName', { reason: 'late failure' }),
    ];
    expect(deriveStatus(field({ status: 'unverifiedCitation', confidence: 0.1 }), events)).toBe(
      'failed',
    );
  });
});

describe('sortFields', () => {
  const failed = ev('stepFailed', 'fillField:feeTotal');
  const skipped = ev('stepSkipped', 'fillField:settlementDate', { reason: 'no value' });
  const fuzzy = ev('stepVerified', 'fillField:issuerName', { via: 'fuzzy' });
  const verifiedPlain = ev('stepVerified', 'fillField:isConfidential');
  const agent = ev('stepVerified', 'fillField:currency', { via: 'agent' });

  it('sorts attention-first across every status', () => {
    const events: FillEvent[] = [
      ev('stepStarted', 'fillField:feeTotal'),
      failed,
      skipped,
      fuzzy,
      agent,
      verifiedPlain,
    ];
    const fields = [
      field({ fieldId: 'isConfidential' }), // verified
      field({ fieldId: 'currency' }), // filledByAgent
      field({ fieldId: 'isConfidentialDup', confidence: 0.4 }), // lowConfidence
      field({ fieldId: 'issuerName' }), // needsReview (fuzzy event)
      field({ fieldId: 'settlementDate', status: 'notFound' }), // notFound
      field({ fieldId: 'feeTotal' }), // failed
      field({ fieldId: 'notes' }), // no events -> pending
    ];
    expect(sortFields(fields, events).map((f) => f.fieldId)).toEqual([
      'feeTotal', // failed
      'settlementDate', // notFound
      'issuerName', // needsReview (fuzzy)
      'isConfidentialDup', // lowConfidence
      'currency', // filledByAgent
      'isConfidential', // verified
      'notes', // pending
    ]);
  });

  it('keeps config order stable within a status group', () => {
    const fields = [
      field({ fieldId: 'one' }),
      field({ fieldId: 'two' }),
      field({ fieldId: 'three' }),
    ];
    expect(sortFields(fields, []).map((f) => f.fieldId)).toEqual(['one', 'two', 'three']);
  });

  it('does not mutate the input', () => {
    const fields = [field({ fieldId: 'aaa' }), field({ fieldId: 'bbb' })];
    const events = [ev('stepFailed', 'fillField:bbb')];
    sortFields(fields, events);
    expect(fields.map((f) => f.fieldId)).toEqual(['aaa', 'bbb']);
  });
});
