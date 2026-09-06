import { describe, expect, it } from 'vitest';
import type { AdapterCtx } from '@fib/adapters';
import type { ApiClient } from '@fib/api-client';
import type {
  AgentStepRequest,
  AgentStepResponse,
  BrowserDriver,
  LocatorSpec,
  Ref,
} from '@fib/core';
import type { FillStep } from '@fib/contracts';
import { A11yFallbackAgent } from './A11yFallbackAgent.js';
import type { FallbackBudget } from './types.js';

// ---------------------------------------------------------------------------
// In-memory fakes (no Electron/DOM, no real browser).
// ---------------------------------------------------------------------------

/** Queues one response per agentStep call; `defaultResponse` answers after. */
class FakeApi {
  calls: AgentStepRequest[] = [];
  private pending: AgentStepResponse[] = [];

  queue(...steps: AgentStepResponse[]): void {
    this.pending.push(...steps);
  }

  async agentStep(req: AgentStepRequest): Promise<AgentStepResponse> {
    // Snapshot the history as it was at call time (the agent reuses one array).
    this.calls.push({ ...req, history: req.history.map((entry) => ({ ...entry })) });
    return this.pending.shift() ?? { tool: 'readValue', ref: 'e1' };
  }
}

class FakeDriver implements BrowserDriver {
  readonly refs = new Set<string>();
  readonly log: string[] = [];
  waitForCalls: { target: LocatorSpec | Ref; state: string; timeoutMs: number }[] = [];
  readValues = new Map<string, string>();

  async connect(): Promise<void> {}
  async click(t: LocatorSpec | Ref): Promise<void> {
    this.assertKnownRef(t);
  }
  async type(t: LocatorSpec | Ref): Promise<void> {
    this.assertKnownRef(t);
  }
  async fill(): Promise<void> {}
  async selectByLabel(): Promise<void> {}
  async press(t: LocatorSpec | Ref): Promise<void> {
    this.assertKnownRef(t);
  }
  async readValue(t: LocatorSpec | Ref): Promise<string | null> {
    this.assertKnownRef(t);
    if (!('ref' in t)) return null;
    return this.readValues.get(t.ref) ?? null;
  }
  async readText(): Promise<string> {
    return '';
  }
  async count(): Promise<number> {
    return 0;
  }
  async waitFor(t: LocatorSpec | Ref, state: string, timeoutMs: number): Promise<void> {
    this.waitForCalls.push({ target: t, state, timeoutMs });
    this.assertKnownRef(t);
  }
  async waitStable(): Promise<void> {}
  async ariaSnapshot(): Promise<{ yaml: string; refs: string[] }> {
    return { yaml: '- textbox "Deal amount" [ref=e1]', refs: [...this.refs] };
  }
  setNeverClick(): void {}

  addRef(ref: string): void {
    this.refs.add(ref);
  }

  private assertKnownRef(t: LocatorSpec | Ref): void {
    if ('ref' in t && !this.refs.has(t.ref)) {
      throw new Error(`unknown ref "${t.ref}"; take an ariaSnapshot first`);
    }
  }
}

function makeCtx(driver: FakeDriver): AdapterCtx {
  return {
    driver,
    matchOption: async () => ({ index: null, via: 'exact', confidence: 0 }),
    log: (msg) => driver.log.push(msg),
  };
}

// The planner's PlanStep adds control/valueType on top of the wire FillStep.
const STEP = {
  stepId: 's0',
  kind: 'fillField',
  sectionId: 'deal',
  fieldId: 'dealAmount',
  value: '1250000',
  control: 'text',
  valueType: 'string',
} as FillStep;

const BUDGET: FallbackBudget = { attempts: 3, timeoutMs: 20_000 };

// ---------------------------------------------------------------------------
// Acceptance criteria + loop behaviour
// ---------------------------------------------------------------------------

describe('A11yFallbackAgent', () => {
  it('AC: budget.timeoutMs: 1 → { ok: false, reason: "budget exhausted" }', async () => {
    const api = new FakeApi();
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });
    const result = await agent.run(STEP, makeCtx(new FakeDriver()), {
      attempts: 3,
      timeoutMs: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'budget exhausted' });
    // Non-terminal calls only: `done`/`giveUp` would have ended the run early.
    // The loop can legitimately hit the attempts * 4 cap within 1 ms.
    expect(api.calls.length).toBeGreaterThan(0);
    expect(api.calls.length).toBeLessThanOrEqual(3 * 4);
  });

  it('budget.attempts caps the loop at attempts * 4 non-terminal actions', async () => {
    const api = new FakeApi();
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });
    const result = await agent.run(STEP, makeCtx(new FakeDriver()), {
      attempts: 2,
      timeoutMs: 20_000,
    });
    expect(result).toEqual({ ok: false, reason: 'budget exhausted' });
    expect(api.calls).toHaveLength(2 * 4);
  });

  it('done → { ok: true, value } without further calls', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'done', value: '1250000' });
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });
    const result = await agent.run(STEP, makeCtx(new FakeDriver()), BUDGET);
    expect(result).toEqual({ ok: true, value: '1250000' });
    expect(api.calls).toHaveLength(1);
  });

  it('AC: giveUp → { ok: false, reason } with the given reason', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'giveUp', reason: 'field not in the snapshot' });
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });
    const result = await agent.run(STEP, makeCtx(new FakeDriver()), BUDGET);
    expect(result).toEqual({ ok: false, reason: 'field not in the snapshot' });
    expect(api.calls).toHaveLength(1);
  });

  it('sends goal, fieldSpec, snapshot yaml and history; pushes readValue observations', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'readValue', ref: 'e1' }, { tool: 'done', value: '1250000' });
    const driver = new FakeDriver();
    driver.addRef('e1');
    driver.readValues.set('e1', '1250000');
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });

    await agent.run(STEP, makeCtx(driver), BUDGET);

    expect(api.calls).toHaveLength(2);
    expect(api.calls[0]?.goal).toBe('Set field dealAmount to 1250000');
    expect(api.calls[0]?.fieldSpec).toEqual({
      fieldId: 'dealAmount',
      description: 'control: text; label: dealAmount; value: 1250000',
      expectedType: 'string',
    });
    expect(api.calls[0]?.a11ySnapshot).toContain('textbox "Deal amount" [ref=e1]');
    expect(api.calls[0]?.history).toEqual([]);
    expect(api.calls[1]?.history).toEqual([
      { toolCall: { tool: 'readValue', ref: 'e1' }, observation: 'read "1250000"' },
    ]);
  });

  it('executes click/type(clear)/press/waitFor through refs', async () => {
    const api = new FakeApi();
    api.queue(
      { tool: 'click', ref: 'e1' },
      { tool: 'type', ref: 'e1', text: '1250000' },
      { tool: 'press', ref: 'e1', key: 'Enter' },
      { tool: 'waitFor', refOrText: 'e1', ms: 250 },
      { tool: 'done', value: '1250000' },
    );
    const driver = new FakeDriver();
    driver.addRef('e1');
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });

    const result = await agent.run(STEP, makeCtx(driver), BUDGET);

    expect(result).toEqual({ ok: true, value: '1250000' });
    expect(driver.waitForCalls).toEqual([
      { target: { ref: 'e1' }, state: 'visible', timeoutMs: 250 },
    ]);
  });

  it('unknown ref pushes the error to history and continues the loop', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'click', ref: 'e99' }, { tool: 'done', value: '1250000' });
    const driver = new FakeDriver();
    driver.addRef('e1');
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });

    const result = await agent.run(STEP, makeCtx(driver), BUDGET);

    expect(result).toEqual({ ok: true, value: '1250000' });
    expect(api.calls[1]?.history).toEqual([
      {
        toolCall: { tool: 'click', ref: 'e99' },
        observation: 'error: unknown ref "e99"; take an ariaSnapshot first',
      },
    ]);
  });

  it('logs every action through ctx.log', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'done', value: '1250000' });
    const driver = new FakeDriver();
    const agent = new A11yFallbackAgent({ api: api as unknown as ApiClient });

    await agent.run(STEP, makeCtx(driver), BUDGET);

    expect(driver.log.some((msg) => msg.includes('agent action 1 (done)'))).toBe(true);
  });

  it('snapshots the configured scope', async () => {
    const api = new FakeApi();
    api.queue({ tool: 'done', value: 'x' });
    const driver = new FakeDriver();
    const seen: (LocatorSpec | undefined)[] = [];
    driver.ariaSnapshot = async (scope?: LocatorSpec) => {
      seen.push(scope);
      return { yaml: '', refs: [] };
    };
    const agent = new A11yFallbackAgent({ api: api as never, scope: { css: 'form' } });

    await agent.run(STEP, makeCtx(driver), BUDGET);

    expect(seen).toEqual([{ css: 'form' }]);
  });
});
