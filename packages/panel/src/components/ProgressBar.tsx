import type { SessionState } from '@fib/core';
import type { FillEvent } from '@fib/contracts';

const LABELS: Partial<Record<SessionState, string>> = {
  ingesting: 'Ingesting…',
  extracting: 'Extracting…',
  resolving: 'Resolving citations…',
  filling: 'Filling…',
};

const TERMINAL_KINDS = new Set(['stepVerified', 'stepFailed', 'stepSkipped']);

/** Progress for the ingest → extract → resolve → fill pipeline, with a step counter while filling. */
export function ProgressBar({
  state,
  fillEvents,
}: {
  state: SessionState;
  fillEvents: FillEvent[];
}) {
  const label = LABELS[state];
  if (!label) {
    return null;
  }
  // stepSkipped steps never emit stepStarted, so they count toward both sides.
  const total = fillEvents.filter(
    (e) => e.kind === 'stepStarted' || e.kind === 'stepSkipped',
  ).length;
  const completed = fillEvents.filter((e) => TERMINAL_KINDS.has(e.kind)).length;
  return (
    <div className="progress" role="status" data-testid="progress-bar">
      <span>{label}</span>
      {state === 'filling' && total > 0 && (
        <span className="progress__steps" data-testid="step-counter">
          {completed}/{total} steps
        </span>
      )}
      <progress value={total > 0 ? completed : undefined} max={total > 0 ? total : undefined} />
    </div>
  );
}
