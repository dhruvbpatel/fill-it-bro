import type { ApiClient } from '@fib/api-client';
import type { AdapterCtx } from '@fib/adapters';
import type { AgentStepRequest, AgentStepResponse, FillStep, HistoryEntry } from '@fib/contracts';
import type { LocatorSpec } from '@fib/core';
import type { FallbackAgent, FallbackBudget, FallbackOutcome } from './types.js';

/** FillStep plus the planner's extras the agent may see at runtime. */
type FillStepLike = FillStep & { control?: string; valueType?: string };

export interface A11yFallbackAgentOptions {
  api: ApiClient;
  /** Optional scope for `ariaSnapshot`; defaults to the whole page. */
  scope?: LocatorSpec;
}

/** Wire contract's fieldSpec: `{ fieldId, description, expectedType? }`. */
type FieldSpec = AgentStepRequest['fieldSpec'];

/**
 * PLAN §8 step 4 / ticket 20: the client-owned fallback loop. Snapshots the
 * accessibility tree, asks the service for exactly one tool call, executes it
 * through the driver, and stops when the field verifiably holds the value
 * (`done`) or the budget is spent. Stateless across runs: `history` is rebuilt
 * per `run` and sent back so the service sees every action + outcome.
 */
export class A11yFallbackAgent implements FallbackAgent {
  private readonly api: ApiClient;
  private readonly scope: LocatorSpec | undefined;

  constructor(options: A11yFallbackAgentOptions) {
    this.api = options.api;
    this.scope = options.scope;
  }

  async run(step: FillStepLike, ctx: AdapterCtx, budget: FallbackBudget): Promise<FallbackOutcome> {
    const start = Date.now();
    let actions = 0;
    const history: HistoryEntry[] = [];

    // The planner's PlanStep adds `control`/`valueType` on top of the wire
    // FillStep; `label` does not exist on either, so it falls back to fieldId.
    const fieldId = step.fieldId ?? step.stepId;
    const value = step.value ?? '';
    const label = (step as { label?: string }).label ?? fieldId;
    const control = (step as { control?: string }).control ?? '';
    const fieldSpec: FieldSpec = {
      fieldId,
      description: `control: ${control}; label: ${label}; value: ${value}`,
      ...(step.valueType !== undefined ? { expectedType: step.valueType } : {}),
    };

    while (actions < budget.attempts * 4 && Date.now() - start < budget.timeoutMs) {
      const snap = await ctx.driver.ariaSnapshot(this.scope);
      const call = await this.api.agentStep({
        goal: `Set field ${fieldId} to ${value}`,
        fieldSpec,
        a11ySnapshot: snap.yaml,
        history,
      });
      actions += 1;

      let observation: string | null;
      try {
        observation = await this.execute(call, ctx);
      } catch (err) {
        // Unknown refs and driver failures push the error to history so the
        // service can correct course on the next call.
        observation = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      ctx.log(`agent action ${actions} (${call.tool}) on ${fieldId}: ${observation ?? 'ok'}`);

      if (call.tool === 'done') return { ok: true, value: call.value };
      if (call.tool === 'giveUp') return { ok: false, reason: call.reason };

      history.push({ toolCall: call, observation });
    }
    return { ok: false, reason: 'budget exhausted' };
  }

  /** Executes one tool call through the driver and returns the observation. */
  private async execute(call: AgentStepResponse, ctx: AdapterCtx): Promise<string | null> {
    switch (call.tool) {
      case 'click':
        await ctx.driver.click({ ref: call.ref });
        return 'clicked';
      case 'type':
        await ctx.driver.type({ ref: call.ref }, call.text, { clear: true });
        return `typed "${call.text}"`;
      case 'press':
        await ctx.driver.press({ ref: call.ref }, call.key);
        return `pressed ${call.key}`;
      case 'waitFor':
        // refOrText: a known ref resolves to its element; anything else (text)
        // is an unknown ref and lands in the error path.
        await ctx.driver.waitFor({ ref: call.refOrText }, 'visible', call.ms);
        return 'waited';
      case 'readValue': {
        const read = await ctx.driver.readValue({ ref: call.ref });
        return read === null ? 'read null' : `read "${read}"`;
      }
      case 'done':
      case 'giveUp':
        return null; // handled by run()
    }
  }
}
