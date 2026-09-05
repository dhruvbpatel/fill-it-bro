import type { FillEvent, ResolvedField } from '@fib/contracts';

/** Badge states the panel can show for a field (ticket 23). */
export type PanelFieldStatus =
  | 'failed'
  | 'notFound'
  | 'needsReview'
  | 'lowConfidence'
  | 'filledByAgent'
  | 'verified'
  | 'pending';

/**
 * `via` is carried on `stepVerified` events (the fill-event schema gains the
 * enum when the executor lands, ticket 19). Read defensively until then.
 */
type FillEventWithVia = FillEvent & { via?: 'exact' | 'fuzzy' | 'llm' | 'agent' };

/**
 * Events belong to a field when the stepId ends with the field id, delimited
 * by `:` (planner convention `fillField:<fieldId>`) or `.` (grid cells
 * `fillCell:parties[0].<colId>`).
 */
export function eventsForField(events: FillEvent[], fieldId: string): FillEvent[] {
  const colon = `:${fieldId}`;
  const dot = `.${fieldId}`;
  return events.filter(
    (e) => e.stepId === fieldId || e.stepId.endsWith(colon) || e.stepId.endsWith(dot),
  );
}

/** Derives the badge status for one field from its resolved state and fill events. */
export function deriveStatus(field: ResolvedField, events: FillEvent[]): PanelFieldStatus {
  const fieldEvents = eventsForField(events, field.fieldId);
  const last = fieldEvents.at(-1);
  if (last?.kind === 'stepFailed') {
    return 'failed';
  }
  const viaOf = (e: FillEvent): string | undefined => (e as FillEventWithVia).via;
  const verified = fieldEvents.filter((e) => e.kind === 'stepVerified');
  if (verified.some((e) => viaOf(e) === 'agent')) {
    return 'filledByAgent';
  }
  if (
    verified.some((e) => viaOf(e) === 'fuzzy' || viaOf(e) === 'llm') ||
    field.status === 'unverifiedCitation'
  ) {
    return 'needsReview';
  }
  if (field.confidence < 0.6) {
    return 'lowConfidence';
  }
  if (field.status === 'notFound') {
    return 'notFound';
  }
  if (verified.length > 0) {
    return 'verified';
  }
  return 'pending';
}

/** Attention-first sort (ticket 23); stable so config order wins inside a group. */
const STATUS_ORDER: readonly PanelFieldStatus[] = [
  'failed',
  'notFound',
  'needsReview',
  'lowConfidence',
  'filledByAgent',
  'verified',
  'pending',
];

export function sortFields(fields: ResolvedField[], events: FillEvent[]): ResolvedField[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(deriveStatus(a.field, events)) -
          STATUS_ORDER.indexOf(deriveStatus(b.field, events)) || a.index - b.index,
    )
    .map((entry) => entry.field);
}
