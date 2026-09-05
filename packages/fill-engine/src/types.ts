import type { AdapterCtx } from '@fib/adapters';
import type { FillStep } from '@fib/contracts';

/** PLAN §15 (verbatim): default is { attempts: 3, backoffMs: [300, 800, 1500] }. */
export interface RetryPolicy {
  attempts: number;
  backoffMs: number[];
}

export type FallbackOutcome = { ok: true; value: string } | { ok: false; reason: string };

export interface FallbackBudget {
  attempts: number;
  timeoutMs: number;
}

/** PLAN §15 (verbatim shape): the client-owned fallback loop runs against this. */
export interface FallbackAgent {
  run(step: FillStep, ctx: AdapterCtx, budget: FallbackBudget): Promise<FallbackOutcome>;
}

export type StepStatus = 'verified' | 'failed' | 'skipped';

export type VerifiedVia = 'exact' | 'fuzzy' | 'llm' | 'agent';

/** Per-step result recorded in a {@link FillReport}. */
export interface StepOutcome {
  stepId: string;
  status: StepStatus;
  attempts: number;
  via?: VerifiedVia;
  reason?: string;
}

/**
 * Engine-level run summary. Richer than the wire `FillReport` contract: adds the
 * `aborted` flag, per-outcome counts, and wall-clock duration (T19).
 */
export interface FillReport {
  counts: Record<StepStatus, number>;
  steps: StepOutcome[];
  aborted: boolean;
  durationMs: number;
}
