import type { DocumentSet, ExtractionResult, FillEvent, ResolvedField } from '@fib/contracts';

/** One step in a fill session's lifecycle (PLAN §5). */
export type SessionState =
  | 'idle'
  | 'launching'
  | 'formReady'
  | 'ingesting'
  | 'extracting'
  | 'resolving'
  | 'filling'
  | 'review'
  | 'done'
  | 'failed';

export type SessionEvent =
  | { type: 'launch'; dealId: string; formId: string }
  | { type: 'formReady' }
  | { type: 'filesDropped'; paths: string[] }
  | { type: 'ingested'; documentSet: DocumentSet }
  | { type: 'extracted'; result: ExtractionResult }
  | { type: 'resolved'; fields: ResolvedField[] }
  | { type: 'fillEvent'; event: FillEvent }
  | { type: 'fillComplete' }
  | { type: 'userEdit'; fieldId: string; value: string }
  | { type: 'finish' }
  | { type: 'fail'; reason: string };

export interface SessionSnapshot {
  state: SessionState;
  dealId?: string;
  formId?: string;
  documentSet?: DocumentSet;
  extraction?: ExtractionResult;
  fields: ResolvedField[];
  fillEvents: FillEvent[];
  error?: string;
}

export class IllegalTransition extends Error {
  constructor(
    readonly state: SessionState,
    readonly eventType: SessionEvent['type'],
  ) {
    super(`IllegalTransition: event '${eventType}' is not allowed in state '${state}'`);
    this.name = 'IllegalTransition';
  }
}

export function initialSnapshot(): SessionSnapshot {
  return { state: 'idle', fields: [], fillEvents: [] };
}

/** Pure reducer: returns a new snapshot, never mutates its input; throws on illegal transition. */
export function reduce(s: SessionSnapshot, e: SessionEvent): SessionSnapshot {
  switch (e.type) {
    case 'launch':
      expectState(s, 'idle', e.type);
      return { ...s, state: 'launching', dealId: e.dealId, formId: e.formId };
    case 'formReady':
      expectState(s, 'launching', e.type);
      return { ...s, state: 'formReady' };
    case 'filesDropped':
      // Drop-anytime rerun (Task 2): a drop from review/done/failed restarts
      // the pipeline with document-level state cleared; dealId/formId persist.
      if (s.state === 'formReady') return { ...s, state: 'ingesting' };
      if (s.state === 'review' || s.state === 'done' || s.state === 'failed') {
        return {
          ...s,
          state: 'ingesting',
          documentSet: undefined,
          extraction: undefined,
          fields: [],
          fillEvents: [],
          error: undefined,
        };
      }
      throw new IllegalTransition(s.state, e.type);
    case 'ingested':
      expectState(s, 'ingesting', e.type);
      return { ...s, state: 'extracting', documentSet: e.documentSet };
    case 'extracted':
      expectState(s, 'extracting', e.type);
      return { ...s, state: 'resolving', extraction: e.result };
    case 'resolved':
      expectState(s, 'resolving', e.type);
      return { ...s, state: 'filling', fields: e.fields };
    case 'fillEvent':
      expectState(s, 'filling', e.type);
      return { ...s, fillEvents: [...s.fillEvents, e.event] };
    case 'fillComplete':
      expectState(s, 'filling', e.type);
      return { ...s, state: 'review' };
    case 'userEdit': {
      expectState(s, 'review', e.type);
      const fields: ResolvedField[] = s.fields.map((f) =>
        f.fieldId === e.fieldId ? { ...f, value: e.value, status: 'found' as const } : f,
      );
      return { ...s, state: 'filling', fields };
    }
    case 'finish':
      expectState(s, 'review', e.type);
      return { ...s, state: 'done' };
    case 'fail':
      return { ...s, state: 'failed', error: e.reason };
  }
}

function expectState(
  s: SessionSnapshot,
  expected: SessionState,
  eventType: SessionEvent['type'],
): void {
  if (s.state !== expected) {
    throw new IllegalTransition(s.state, eventType);
  }
}
