import { describe, expect, it } from 'vitest';
import type { DocumentSet, ExtractionResult, FillEvent, ResolvedField } from '@fib/contracts';
import {
  IllegalTransition,
  initialSnapshot,
  reduce,
  type SessionEvent,
  type SessionSnapshot,
  type SessionState,
} from './session';

const documentSet: DocumentSet = {
  setId: 'set-1',
  sources: [{ sourceId: 'src-1', kind: 'upload', name: 'deal.pdf', mime: 'application/pdf' }],
  manifest: [{ mergedPage: 1, sourceId: 'src-1', sourcePage: 1 }],
  pages: [
    {
      mergedPage: 1,
      width: 612,
      height: 792,
      items: [{ id: 'p1i0', text: 'Goldman Sachs Incorporated', x: 72, y: 720, w: 200, h: 12 }],
    },
  ],
};

const extraction: ExtractionResult = {
  runId: 'run-1',
  fields: [
    {
      fieldId: 'issuerName',
      value: 'Goldman Sachs Incorporated',
      valueType: 'string',
      status: 'found',
      confidence: 0.97,
      sourceId: 'src-1',
      citations: [{ itemIds: ['p1i0'], quote: 'Goldman Sachs Incorporated' }],
      reason: null,
    },
  ],
  groups: [],
};

const resolvedFields: ResolvedField[] = [
  {
    fieldId: 'issuerName',
    value: 'Goldman Sachs Incorporated',
    valueType: 'string',
    status: 'found',
    confidence: 0.97,
    sourceId: 'src-1',
    reason: null,
    citations: [
      {
        mergedPage: 1,
        boxes: [{ x: 72, y: 720, w: 200, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'src-1',
        sourcePage: 1,
      },
    ],
  },
  {
    fieldId: 'dealAmount',
    value: null,
    valueType: 'number',
    status: 'notFound',
    confidence: 0,
    sourceId: null,
    reason: 'not mentioned',
    citations: [],
  },
];

const fillEvent: FillEvent = { stepId: 'step-1', kind: 'stepStarted' };

/** Drive the reducer from the initial snapshot to the requested state via the happy path. */
function snapshotIn(state: SessionState): SessionSnapshot {
  if (state === 'idle') return initialSnapshot();
  let s = initialSnapshot();
  const path: Record<Exclude<SessionState, 'idle' | 'failed'>, SessionEvent[]> = {
    launching: [{ type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' }],
    formReady: [{ type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' }, { type: 'formReady' }],
    ingesting: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
    ],
    extracting: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
    ],
    resolving: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
      { type: 'extracted', result: extraction },
    ],
    filling: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
      { type: 'extracted', result: extraction },
      { type: 'resolved', fields: resolvedFields },
    ],
    review: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
      { type: 'extracted', result: extraction },
      { type: 'resolved', fields: resolvedFields },
      { type: 'fillComplete' },
    ],
    done: [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
      { type: 'extracted', result: extraction },
      { type: 'resolved', fields: resolvedFields },
      { type: 'fillComplete' },
      { type: 'finish' },
    ],
  };
  for (const e of path[state]) s = reduce(s, e);
  return s;
}

interface Edge {
  name: string;
  from: SessionState;
  event: SessionEvent;
  to: SessionState;
  verify?: (next: SessionSnapshot) => void;
}

const legalEdges: Edge[] = [
  {
    name: 'idle --launch--> launching',
    from: 'idle',
    event: { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
    to: 'launching',
    verify: (n) => {
      expect(n.dealId).toBe('D-42');
      expect(n.formId).toBe('fixtureDeal');
    },
  },
  {
    name: 'launching --formReady--> formReady',
    from: 'launching',
    event: { type: 'formReady' },
    to: 'formReady',
  },
  {
    name: 'formReady --filesDropped--> ingesting',
    from: 'formReady',
    event: { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
    to: 'ingesting',
  },
  {
    name: 'ingesting --ingested--> extracting',
    from: 'ingesting',
    event: { type: 'ingested', documentSet },
    to: 'extracting',
    verify: (n) => expect(n.documentSet).toBe(documentSet),
  },
  {
    name: 'extracting --extracted--> resolving',
    from: 'extracting',
    event: { type: 'extracted', result: extraction },
    to: 'resolving',
    verify: (n) => expect(n.extraction).toBe(extraction),
  },
  {
    name: 'resolving --resolved--> filling',
    from: 'resolving',
    event: { type: 'resolved', fields: resolvedFields },
    to: 'filling',
    verify: (n) => expect(n.fields).toBe(resolvedFields),
  },
  {
    name: 'filling --fillEvent--> filling (appends)',
    from: 'filling',
    event: { type: 'fillEvent', event: fillEvent },
    to: 'filling',
    verify: (n) => expect(n.fillEvents).toEqual([fillEvent]),
  },
  {
    name: 'filling --fillComplete--> review',
    from: 'filling',
    event: { type: 'fillComplete' },
    to: 'review',
  },
  {
    name: 'review --userEdit--> filling (updates field)',
    from: 'review',
    event: { type: 'userEdit', fieldId: 'dealAmount', value: '1250000' },
    to: 'filling',
    verify: (n) => {
      expect(n.fields).toHaveLength(2);
      const edited = n.fields.find((f) => f.fieldId === 'dealAmount');
      expect(edited?.value).toBe('1250000');
      expect(edited?.status).toBe('found');
      const untouched = n.fields.find((f) => f.fieldId === 'issuerName');
      expect(untouched?.value).toBe('Goldman Sachs Incorporated');
    },
  },
  { name: 'review --finish--> done', from: 'review', event: { type: 'finish' }, to: 'done' },
  {
    name: 'review --filesDropped--> ingesting (rerun resets document state)',
    from: 'review',
    event: { type: 'filesDropped', paths: ['/tmp/next-deal.pdf'] },
    to: 'ingesting',
    verify: (n) => {
      expect(n.documentSet).toBeUndefined();
      expect(n.fields).toEqual([]);
      expect(n.dealId).toBe('D-42');
    },
  },
  {
    name: 'idle --fail--> failed',
    from: 'idle',
    event: { type: 'fail', reason: 'boom' },
    to: 'failed',
    verify: (n) => expect(n.error).toBe('boom'),
  },
  {
    name: 'extracting --fail--> failed',
    from: 'extracting',
    event: { type: 'fail', reason: 'gateway 500' },
    to: 'failed',
    verify: (n) => expect(n.error).toBe('gateway 500'),
  },
  {
    name: 'review --fail--> failed',
    from: 'review',
    event: { type: 'fail', reason: 'user aborted' },
    to: 'failed',
    verify: (n) => expect(n.error).toBe('user aborted'),
  },
  {
    name: 'done --fail--> failed',
    from: 'done',
    event: { type: 'fail', reason: 'post-run failure' },
    to: 'failed',
    verify: (n) => expect(n.error).toBe('post-run failure'),
  },
];

describe('filesDropped rerun (Task 2: drop-anytime)', () => {
  it('review --filesDropped--> ingesting resets document-level state and keeps dealId/formId', () => {
    const before = snapshotIn('review');
    expect(before.documentSet).toBeDefined();
    expect(before.extraction).toBeDefined();
    expect(before.fields.length).toBeGreaterThan(0);
    expect(before.fillEvents.length).toBeGreaterThan(0);
    expect(before.error).toBeUndefined();

    const next = reduce(before, { type: 'filesDropped', paths: ['/tmp/next.pdf'] });

    expect(next.state).toBe('ingesting');
    expect(next.documentSet).toBeUndefined();
    expect(next.extraction).toBeUndefined();
    expect(next.fields).toEqual([]);
    expect(next.fillEvents).toEqual([]);
    expect(next.error).toBeUndefined();
    expect(next.dealId).toBe('D-42');
    expect(next.formId).toBe('fixtureDeal');
  });

  it('done --filesDropped--> ingesting resets document-level state and keeps dealId/formId', () => {
    const before = snapshotIn('done');
    expect(before.fields.length).toBeGreaterThan(0);
    expect(before.fillEvents.length).toBeGreaterThan(0);

    const next = reduce(before, { type: 'filesDropped', paths: ['/tmp/next.pdf'] });

    expect(next.state).toBe('ingesting');
    expect(next.documentSet).toBeUndefined();
    expect(next.extraction).toBeUndefined();
    expect(next.fields).toEqual([]);
    expect(next.fillEvents).toEqual([]);
    expect(next.error).toBeUndefined();
    expect(next.dealId).toBe('D-42');
    expect(next.formId).toBe('fixtureDeal');
  });

  it('failed --filesDropped--> ingesting resets document-level state and keeps dealId/formId', () => {
    const failed = reduce(initialSnapshot(), { type: 'fail', reason: 'boom' });
    const before = reduce(failed, {
      type: 'launch',
      dealId: 'D-42',
      formId: 'fixtureDeal',
    });

    const next = reduce(before, { type: 'filesDropped', paths: ['/tmp/next.pdf'] });

    expect(next.state).toBe('ingesting');
    expect(next.documentSet).toBeUndefined();
    expect(next.extraction).toBeUndefined();
    expect(next.fields).toEqual([]);
    expect(next.fillEvents).toEqual([]);
    expect(next.error).toBeUndefined();
    expect(next.dealId).toBe('D-42');
    expect(next.formId).toBe('fixtureDeal');
  });

  it('formReady --filesDropped--> ingesting keeps the single-transition shape (no reset needed)', () => {
    const before = snapshotIn('formReady');

    const next = reduce(before, { type: 'filesDropped', paths: ['/tmp/deal.pdf'] });

    expect(next.state).toBe('ingesting');
    expect(next.dealId).toBe('D-42');
    expect(next.formId).toBe('fixtureDeal');
  });

  it('still illegal: filesDropped throws from every state except formReady|review|done|failed', () => {
    const illegalStates: SessionState[] = [
      'idle',
      'launching',
      'ingesting',
      'extracting',
      'resolving',
      'filling',
    ];
    for (const state of illegalStates) {
      const before = snapshotIn(state);
      expect(() => reduce(before, { type: 'filesDropped', paths: ['/tmp/next.pdf'] })).toThrow(
        IllegalTransition,
      );
    }
  });
});

describe('session reducer', () => {
  it('initialSnapshot() is idle with empty collections', () => {
    const s = initialSnapshot();
    expect(s.state).toBe('idle');
    expect(s.fields).toEqual([]);
    expect(s.fillEvents).toEqual([]);
  });

  describe('legal edges (table-driven)', () => {
    for (const edge of legalEdges) {
      it(edge.name, () => {
        const before = snapshotIn(edge.from);
        const next = reduce(before, edge.event);
        expect(next.state).toBe(edge.to);
        edge.verify?.(next);
      });
    }
  });

  describe('illegal transitions throw IllegalTransition', () => {
    const illegal: Array<{ name: string; from: SessionState; event: SessionEvent }> = [
      { name: 'idle + formReady', from: 'idle', event: { type: 'formReady' } },
      {
        name: 'filling + launch',
        from: 'filling',
        event: { type: 'launch', dealId: 'D-9', formId: 'fixtureDeal' },
      },
      {
        name: 'review + fillEvent',
        from: 'review',
        event: { type: 'fillEvent', event: fillEvent },
      },
      {
        name: 'done + userEdit',
        from: 'done',
        event: { type: 'userEdit', fieldId: 'dealAmount', value: '1' },
      },
      { name: 'idle + finish', from: 'idle', event: { type: 'finish' } },
    ];

    for (const row of illegal) {
      it(`${row.name} throws with state and event in the message`, () => {
        const before = snapshotIn(row.from);
        expect(() => reduce(before, row.event)).toThrow(IllegalTransition);
        try {
          reduce(before, row.event);
        } catch (err) {
          expect(err).toBeInstanceOf(IllegalTransition);
          const e = err as IllegalTransition;
          expect(e.state).toBe(row.from);
          expect(e.eventType).toBe(row.event.type);
          expect(e.message).toContain(row.from);
          expect(e.message).toContain(row.event.type);
        }
      });
    }
  });

  it('reduce never mutates its input (frozen snapshots and events)', () => {
    const deepFreeze = <T>(value: T): T => {
      if (value !== null && typeof value === 'object') {
        for (const key of Object.keys(value as Record<string, unknown>)) {
          deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
      }
      return value;
    };

    for (const edge of legalEdges) {
      const before = deepFreeze(structuredClone(snapshotIn(edge.from)));
      const event = deepFreeze(structuredClone(edge.event));
      const next = reduce(before, event);
      expect(next).not.toBe(before);
      expect(next.state).toBe(edge.to);
    }
  });

  it('a full session walks idle→…→done without mutation of prior snapshots', () => {
    const snapshots: SessionSnapshot[] = [initialSnapshot()];
    const events: SessionEvent[] = [
      { type: 'launch', dealId: 'D-42', formId: 'fixtureDeal' },
      { type: 'formReady' },
      { type: 'filesDropped', paths: ['/tmp/deal.pdf'] },
      { type: 'ingested', documentSet },
      { type: 'extracted', result: extraction },
      { type: 'resolved', fields: resolvedFields },
      { type: 'fillEvent', event: fillEvent },
      { type: 'fillComplete' },
      { type: 'userEdit', fieldId: 'dealAmount', value: '1250000' },
      { type: 'fillComplete' },
      { type: 'finish' },
    ];
    let s = snapshots[0];
    for (const e of events) {
      s = reduce(s, e);
      snapshots.push(s);
    }
    expect(s.state).toBe('done');
    // every earlier snapshot is unchanged
    expect(snapshots[0].state).toBe('idle');
    expect(snapshots[6].fields.find((f) => f.fieldId === 'dealAmount')?.value).toBeNull();
    expect(snapshots[9].fields.find((f) => f.fieldId === 'dealAmount')?.value).toBe('1250000');
    expect(snapshots[6].fillEvents).toEqual([]);
  });
});
