import {
  valuesEqual,
  type AdapterCtx,
  type MatchOptionResult,
  type WidgetAdapter,
  type WidgetProfile,
} from '@fib/adapters';
import { NeverClickError, type BrowserDriver, type LocatorSpec } from '@fib/core';
import type { FillEvent, FillPlan, FillStep, WidgetProfiles } from '@fib/contracts';
import type {
  FallbackAgent,
  FallbackOutcome,
  FillReport,
  RetryPolicy,
  StepOutcome,
  VerifiedVia,
} from './types.js';

export interface ExecutorOptions {
  driver: BrowserDriver;
  registry: Map<WidgetAdapter['control'], WidgetAdapter>;
  matchOption: (wanted: string, options: string[]) => Promise<MatchOptionResult>;
  fallback: FallbackAgent;
  retry?: RetryPolicy;
  neverClick: LocatorSpec[];
  profiles: WidgetProfiles;
}

/** PLAN §15: default { attempts: 3, backoffMs: [300, 800, 1500] }. */
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, backoffMs: [300, 800, 1500] };

/** PLAN §8 step 4: fallback budget of 3 attempts / 20 s. */
const FALLBACK_BUDGET = { attempts: 3, timeoutMs: 20000 };

/**
 * Core's `PlanStep` extras the planner adds on top of the wire `FillStep`
 * (control/profile/valueType + the noValue skip marker).
 */
type ExecStep = FillStep & {
  control?: string;
  profile?: string;
  valueType?: string;
  skip?: boolean;
  reason?: string;
};

/** Wraps a NeverClickError so the run loop can abort while keeping the attempt count. */
class NeverClickFailure extends Error {
  constructor(
    readonly attempts: number,
    error: NeverClickError,
  ) {
    super(error.message);
    this.name = 'NeverClickFailure';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type AttemptOutcome = { ok: true; via: VerifiedVia } | { ok: false; reason: string };

/**
 * PLAN §15 `Executor` (this class is that interface's implementation) and the
 * T19 engine per PLAN §8 steps 1–3 and 5: per step, pick the adapter, write,
 * read back, compare, retry with backoff, hand off to the fallback agent,
 * stream a `FillEvent` for every state change, and never touch Submit
 * (`neverClick` patterns are pushed into the driver before the first step).
 */
export class Executor {
  private readonly opts: ExecutorOptions;
  private readonly retry: RetryPolicy;

  constructor(opts: ExecutorOptions) {
    this.opts = opts;
    this.retry = opts.retry ?? DEFAULT_RETRY;
  }

  async run(plan: FillPlan, onEvent: (e: FillEvent) => void): Promise<FillReport> {
    const startedAt = Date.now();

    // Ticket: "driver.setNeverClick(neverClick) first" — before any step runs.
    this.opts.driver.setNeverClick(this.opts.neverClick);

    const ctx: AdapterCtx = {
      driver: this.opts.driver,
      matchOption: this.opts.matchOption,
      log: () => {},
    };

    const outcomes: StepOutcome[] = [];
    let aborted = false;

    for (const step of plan.steps as ExecStep[]) {
      if (step.skip) {
        const reason = step.reason ?? 'skipped';
        onEvent({ stepId: step.stepId, kind: 'stepSkipped', reason });
        outcomes.push({ stepId: step.stepId, status: 'skipped', attempts: 0, reason });
        continue;
      }
      try {
        switch (step.kind) {
          case 'navigateTab':
            outcomes.push(await this.runFireStep(step, 'tab', ctx, onEvent));
            break;
          case 'reveal':
            outcomes.push(await this.runFireStep(step, 'button', ctx, onEvent));
            break;
          case 'addRow':
            outcomes.push(await this.ensureRow(step, ctx, onEvent));
            break;
          case 'fillField':
          case 'fillCell':
            outcomes.push(await this.runValueStep(step, ctx, onEvent));
            break;
        }
      } catch (err) {
        if (err instanceof NeverClickFailure) {
          onEvent({ stepId: step.stepId, kind: 'stepFailed', reason: err.message });
          outcomes.push({
            stepId: step.stepId,
            status: 'failed',
            attempts: err.attempts,
            reason: err.message,
          });
          aborted = true;
          break;
        }
        throw err;
      }
    }

    const counts = { verified: 0, failed: 0, skipped: 0 };
    for (const outcome of outcomes) counts[outcome.status] += 1;

    return { counts, steps: outcomes, aborted, durationMs: Date.now() - startedAt };
  }

  /**
   * navigateTab → tab adapter; reveal → button adapter. Single shot,
   * verified by no-throw.
   */
  private async runFireStep(
    step: ExecStep,
    control: WidgetAdapter['control'],
    ctx: AdapterCtx,
    onEvent: (e: FillEvent) => void,
  ): Promise<StepOutcome> {
    const adapter = this.opts.registry.get(control);
    if (!adapter) return this.failWithoutAdapter(step, control, onEvent);

    onEvent({ stepId: step.stepId, kind: 'stepStarted' });
    try {
      await adapter.write(ctx, step.locator ?? {}, '');
    } catch (err) {
      if (err instanceof NeverClickError) throw new NeverClickFailure(1, err);
      const reason = messageOf(err);
      onEvent({ stepId: step.stepId, kind: 'stepFailed', reason });
      return { stepId: step.stepId, status: 'failed', attempts: 1, reason };
    }
    onEvent({ stepId: step.stepId, kind: 'stepVerified' });
    return { stepId: step.stepId, status: 'verified', attempts: 1 };
  }

  /**
   * addRow → ensureRow. v1 (pre-T18): ensure the row exists by clicking the
   * plan's add-row locator through the button adapter; row-count waiting and
   * cell targeting land with the agGridCell adapter (T18).
   */
  private ensureRow(
    step: ExecStep,
    ctx: AdapterCtx,
    onEvent: (e: FillEvent) => void,
  ): Promise<StepOutcome> {
    return this.runFireStep(step, 'button', ctx, onEvent);
  }

  /** fillField/fillCell attempt loop per the ticket, then the fallback hand-off. */
  private async runValueStep(
    step: ExecStep,
    ctx: AdapterCtx,
    onEvent: (e: FillEvent) => void,
  ): Promise<StepOutcome> {
    const control = step.control as WidgetAdapter['control'] | undefined;
    const adapter = control !== undefined ? this.opts.registry.get(control) : undefined;
    if (control === undefined || !adapter) {
      return this.failWithoutAdapter(step, control ?? 'unknown', onEvent);
    }

    const profile = step.profile !== undefined ? this.opts.profiles[step.profile] : undefined;
    const target = step.locator ?? {};
    const value = step.value ?? '';

    onEvent({ stepId: step.stepId, kind: 'stepStarted' });

    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      const result = await this.attemptOnce(adapter, ctx, control, target, value, profile, attempt);
      if (result.ok) {
        onEvent({ stepId: step.stepId, kind: 'stepVerified', via: result.via });
        return { stepId: step.stepId, status: 'verified', attempts: attempt, via: result.via };
      }
      onEvent({ stepId: step.stepId, kind: 'stepRetrying', attempt, reason: result.reason });
      await sleep(this.retry.backoffMs[attempt - 1] ?? 0);
    }

    // Retries exhausted → hand off to the fallback agent (PLAN §8 step 4).
    return this.runFallback(step, adapter, ctx, control, target, value, profile, onEvent);
  }

  /** One write → read → compare round; throws NeverClickFailure out of the loop. */
  private async attemptOnce(
    adapter: WidgetAdapter,
    ctx: AdapterCtx,
    control: WidgetAdapter['control'],
    target: LocatorSpec,
    value: string,
    profile: WidgetProfile | undefined,
    attempt: number,
  ): Promise<AttemptOutcome> {
    try {
      const written = await adapter.write(ctx, target, value, profile);
      const read = await adapter.read(ctx, target, profile);
      if (read !== null && valuesEqual(control, value, read)) {
        return { ok: true, via: written?.via ?? 'exact' };
      }
      return {
        ok: false,
        reason: read === null ? 'read returned null' : 'value mismatch after write',
      };
    } catch (err) {
      if (err instanceof NeverClickError) throw new NeverClickFailure(attempt, err);
      return { ok: false, reason: messageOf(err) };
    }
  }

  private async runFallback(
    step: ExecStep,
    adapter: WidgetAdapter,
    ctx: AdapterCtx,
    control: WidgetAdapter['control'],
    target: LocatorSpec,
    value: string,
    profile: WidgetProfile | undefined,
    onEvent: (e: FillEvent) => void,
  ): Promise<StepOutcome> {
    onEvent({ stepId: step.stepId, kind: 'stepFallback' });
    let result: FallbackOutcome;
    try {
      result = await this.opts.fallback.run(step, ctx, FALLBACK_BUDGET);
    } catch (err) {
      if (err instanceof NeverClickError) {
        throw new NeverClickFailure(this.retry.attempts, err);
      }
      result = { ok: false, reason: messageOf(err) };
    }

    if (result.ok) {
      try {
        const read = await adapter.read(ctx, target, profile);
        if (read !== null && valuesEqual(control, value, read)) {
          onEvent({ stepId: step.stepId, kind: 'stepVerified', via: 'agent' });
          return {
            stepId: step.stepId,
            status: 'verified',
            attempts: this.retry.attempts,
            via: 'agent',
          };
        }
      } catch {
        // read failure after `done` counts as a mismatch
      }
      const mismatch = 'agent reported done but value mismatch';
      onEvent({ stepId: step.stepId, kind: 'stepFailed', reason: mismatch });
      return {
        stepId: step.stepId,
        status: 'failed',
        attempts: this.retry.attempts,
        reason: mismatch,
      };
    }

    onEvent({ stepId: step.stepId, kind: 'stepFailed', reason: result.reason });
    return {
      stepId: step.stepId,
      status: 'failed',
      attempts: this.retry.attempts,
      reason: result.reason,
    };
  }

  private failWithoutAdapter(
    step: ExecStep,
    control: string,
    onEvent: (e: FillEvent) => void,
  ): StepOutcome {
    const reason = `no adapter registered for control "${control}"`;
    onEvent({ stepId: step.stepId, kind: 'stepFailed', reason });
    return { stepId: step.stepId, status: 'failed', attempts: 0, reason };
  }
}
