import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MatchOptionResult, WidgetAdapter } from '@fib/adapters';
import {
  NeverClickError,
  buildPlan,
  loadFormBundle,
  type BrowserDriver,
  type LocatorSpec,
  type ResolvedGroup,
} from '@fib/core';
import type { FillEvent, FillPlan, FillStep, ResolvedField, WidgetProfiles } from '@fib/contracts';
import { DEFAULT_RETRY, Executor } from './Executor.js';
import { NoopFallbackAgent } from './NoopFallbackAgent.js';
import type { RetryPolicy } from './types.js';

// ---------------------------------------------------------------------------
// In-memory fakes (no Electron/DOM, no real browser).
// ---------------------------------------------------------------------------

class FakeDriver implements BrowserDriver {
  neverClickPatterns: LocatorSpec[] | null = null;

  async connect(): Promise<void> {}
  async click(): Promise<void> {}
  async type(): Promise<void> {}
  async fill(): Promise<void> {}
  async selectByLabel(): Promise<void> {}
  async press(): Promise<void> {}
  async readValue(): Promise<string | null> {
    return null;
  }
  async readText(): Promise<string> {
    return '';
  }
  async count(): Promise<number> {
    return 0;
  }
  async waitFor(): Promise<void> {}
  async waitStable(): Promise<void> {}
  async ariaSnapshot(): Promise<{ yaml: string; refs: string[] }> {
    return { yaml: '', refs: [] };
  }
  setNeverClick(patterns: LocatorSpec[]): void {
    this.neverClickPatterns = patterns;
  }
}

interface FakeAdapterOptions {
  control: WidgetAdapter['control'];
  /** First N write calls throw a generic Error (then succeed). */
  failFirstN?: number;
  /** Every write call throws a generic Error. */
  alwaysFail?: boolean;
  /** This 1-based write call throws NeverClickError. */
  neverClickOnCall?: number;
}

function fakeAdapter(opts: FakeAdapterOptions): WidgetAdapter {
  let writes = 0;
  let stored: string | null = null;
  return {
    control: opts.control,
    async write(_ctx, _target, value) {
      writes += 1;
      if (opts.neverClickOnCall !== undefined && writes === opts.neverClickOnCall) {
        throw new NeverClickError(`fake never-click on write ${writes}`);
      }
      if (opts.alwaysFail || (opts.failFirstN !== undefined && writes <= opts.failFirstN)) {
        throw new Error(`fake write ${writes} failed`);
      }
      stored = value;
      return { via: 'exact' };
    },
    async read() {
      return stored;
    },
  };
}

const matchOption = async (): Promise<MatchOptionResult> => ({
  index: null,
  via: 'exact',
  confidence: 1,
});

const FAST_RETRY: RetryPolicy = { attempts: 3, backoffMs: [1, 1, 1] };

interface ExecutorFixture {
  driver: FakeDriver;
  events: FillEvent[];
  run(plan: FillPlan): Promise<ReturnType<Executor['run']>>;
}

function makeExecutor(
  registry: [WidgetAdapter['control'], WidgetAdapter][],
  opts: { retry?: RetryPolicy; neverClick?: LocatorSpec[]; profiles?: WidgetProfiles } = {},
): ExecutorFixture {
  const driver = new FakeDriver();
  const executor = new Executor({
    driver,
    registry: new Map(registry),
    matchOption,
    fallback: new NoopFallbackAgent(),
    retry: opts.retry ?? FAST_RETRY,
    neverClick: opts.neverClick ?? [],
    profiles: opts.profiles ?? {},
  });
  const events: FillEvent[] = [];
  return {
    driver,
    events,
    run: (plan) => executor.run(plan, (e) => events.push(e)),
  };
}

function fillFieldStep(
  stepId: string,
  control: WidgetAdapter['control'],
  value: string,
): FillStep & { control: WidgetAdapter['control'] } {
  return {
    stepId,
    kind: 'fillField',
    sectionId: 'deal',
    fieldId: `${stepId}-field`,
    control,
    locator: { formControlName: `${stepId}-field` },
    value,
    valueType: 'string',
  };
}

// ---------------------------------------------------------------------------
// Acceptance criteria
// ---------------------------------------------------------------------------

describe('Executor', () => {
  it('sets neverClick on the driver before any step runs', async () => {
    const neverClick = [{ role: { role: 'button', name: '/^submit$/i' } }];
    const fx = makeExecutor([['text', fakeAdapter({ control: 'text' })]], {
      neverClick,
    });
    await fx.run({ steps: [fillFieldStep('s0', 'text', 'v')] });
    expect(fx.driver.neverClickPatterns).toEqual(neverClick);
  });

  it('AC1: flaky adapter failing twice then succeeding → stepStarted, stepRetrying×2, stepVerified', async () => {
    const fx = makeExecutor([['text', fakeAdapter({ control: 'text', failFirstN: 2 })]]);
    const report = await fx.run({ steps: [fillFieldStep('s0', 'text', 'hello')] });

    expect(fx.events.map((e) => e.kind)).toEqual([
      'stepStarted',
      'stepRetrying',
      'stepRetrying',
      'stepVerified',
    ]);
    expect(fx.events[1]).toMatchObject({ stepId: 's0', attempt: 1, reason: 'fake write 1 failed' });
    expect(fx.events[2]).toMatchObject({ stepId: 's0', attempt: 2, reason: 'fake write 2 failed' });
    expect(fx.events[3]).toMatchObject({ stepId: 's0', via: 'exact' });
    expect(report.counts).toEqual({ verified: 1, failed: 0, skipped: 0 });
    expect(report.aborted).toBe(false);
    expect(report.steps[0]).toMatchObject({ status: 'verified', attempts: 3, via: 'exact' });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('AC2: always-failing adapter + NoopFallbackAgent → stepFallback, stepFailed, run continues', async () => {
    const fx = makeExecutor([
      ['text', fakeAdapter({ control: 'text', alwaysFail: true })],
      ['checkbox', fakeAdapter({ control: 'checkbox' })],
    ]);
    const report = await fx.run({
      steps: [fillFieldStep('s0', 'text', 'hello'), fillFieldStep('s1', 'checkbox', 'true')],
    });

    expect(fx.events.map((e) => [e.stepId, e.kind])).toEqual([
      ['s0', 'stepStarted'],
      ['s0', 'stepRetrying'],
      ['s0', 'stepRetrying'],
      ['s0', 'stepRetrying'],
      ['s0', 'stepFallback'],
      ['s0', 'stepFailed'],
      ['s1', 'stepStarted'],
      ['s1', 'stepVerified'],
    ]);
    expect(fx.events[5]).toMatchObject({ stepId: 's0', reason: 'no fallback configured' });
    expect(report.aborted).toBe(false);
    expect(report.counts).toEqual({ verified: 1, failed: 1, skipped: 0 });
    expect(report.steps[0]).toMatchObject({ status: 'failed', reason: 'no fallback configured' });
    expect(report.steps[1]).toMatchObject({ status: 'verified' });
  });

  it('AC3: NeverClickError → stepFailed, report.aborted, no further steps executed', async () => {
    const fx = makeExecutor([
      ['text', fakeAdapter({ control: 'text', neverClickOnCall: 1 })],
      ['checkbox', fakeAdapter({ control: 'checkbox' })],
    ]);
    const report = await fx.run({
      steps: [fillFieldStep('s0', 'text', 'hello'), fillFieldStep('s1', 'checkbox', 'true')],
    });

    expect(fx.events.map((e) => [e.stepId, e.kind])).toEqual([
      ['s0', 'stepStarted'],
      ['s0', 'stepFailed'],
    ]);
    expect(fx.events[1]).toMatchObject({
      stepId: 's0',
      reason: 'fake never-click on write 1',
    });
    expect(report.aborted).toBe(true);
    expect(report.steps).toHaveLength(1);
    expect(report.counts).toEqual({ verified: 0, failed: 1, skipped: 0 });
  });

  it('skips steps flagged skip with their reason', async () => {
    const fx = makeExecutor([['text', fakeAdapter({ control: 'text' })]]);
    const plan: FillPlan = {
      steps: [
        {
          stepId: 's0',
          kind: 'fillField',
          sectionId: 'deal',
          fieldId: 'settlementDate',
          skip: true,
          reason: 'noValue',
        } as FillStep,
      ],
    };
    const report = await fx.run(plan);
    expect(fx.events).toEqual([{ stepId: 's0', kind: 'stepSkipped', reason: 'noValue' }]);
    expect(report.counts).toEqual({ verified: 0, failed: 0, skipped: 1 });
  });

  it('fails a step (and keeps going) when no adapter is registered for its control', async () => {
    const fx = makeExecutor([['text', fakeAdapter({ control: 'text' })]]);
    const report = await fx.run({
      steps: [fillFieldStep('s0', 'searchSelect', 'Goldman Sachs')],
    });
    expect(fx.events).toEqual([
      {
        stepId: 's0',
        kind: 'stepFailed',
        reason: 'no adapter registered for control "searchSelect"',
      },
    ]);
    expect(report.counts).toEqual({ verified: 0, failed: 1, skipped: 0 });
    expect(report.aborted).toBe(false);
  });

  it('defaults the retry policy to { attempts: 3, backoffMs: [300, 800, 1500] }', () => {
    expect(DEFAULT_RETRY).toEqual({ attempts: 3, backoffMs: [300, 800, 1500] });
  });

  it('AC4: snapshots the event sequence for the fixtureDeal plan from ticket 13', async () => {
    const REPO_CONFIGS = fileURLToPath(new URL('../../../configs', import.meta.url));
    const bundle = loadFormBundle(REPO_CONFIGS, 'fixtureDeal');

    const resolved = (
      fieldId: string,
      value: string | number | boolean | null,
      valueType = 'string',
    ): ResolvedField => ({
      fieldId,
      value,
      valueType,
      status: value === null ? 'notFound' : 'found',
      confidence: 0.9,
      sourceId: 'src1',
      reason: null,
      citations: [],
    });

    const fields: ResolvedField[] = [
      resolved('issuerName', 'Goldman Sachs Incorporated'),
      resolved('dealAmount', 1500000, 'number'),
      resolved('currency', 'USD'),
      resolved('settlementDate', null, 'date'),
      resolved('isConfidential', false, 'boolean'),
      resolved('feeType', null),
    ];
    const groups: ResolvedGroup[] = [
      {
        groupId: 'parties',
        rows: [
          {
            cells: [
              resolved('partyName', 'Goldman Sachs Incorporated'),
              resolved('role', 'Issuer'),
              resolved('amount', null, 'number'),
            ],
          },
          {
            cells: [
              resolved('partyName', 'Morgan Stanley & Co. LLC'),
              resolved('role', 'Agent'),
              resolved('amount', 250000, 'number'),
            ],
          },
        ],
      },
    ];

    const plan = buildPlan(bundle, fields, groups, { gridRowCounts: { parties: 1 } });

    const fx = makeExecutor(
      [
        ['tab', fakeAdapter({ control: 'tab' })],
        ['button', fakeAdapter({ control: 'button' })],
        ['text', fakeAdapter({ control: 'text' })],
        ['select', fakeAdapter({ control: 'select' })],
        ['checkbox', fakeAdapter({ control: 'checkbox' })],
        ['searchSelect', fakeAdapter({ control: 'searchSelect' })],
        ['agGridCell', fakeAdapter({ control: 'agGridCell' })],
      ],
      { profiles: bundle.profiles, neverClick: bundle.neverClick },
    );

    const report = await fx.run(plan);

    expect(fx.events.map((e) => [e.stepId, e.kind])).toEqual([
      ['s0', 'stepStarted'],
      ['s0', 'stepVerified'],
      ['s1', 'stepStarted'],
      ['s1', 'stepVerified'],
      ['s2', 'stepStarted'],
      ['s2', 'stepVerified'],
      ['s3', 'stepStarted'],
      ['s3', 'stepVerified'],
      ['s4', 'stepStarted'],
      ['s4', 'stepVerified'],
      ['s5', 'stepSkipped'],
      ['s6', 'stepStarted'],
      ['s6', 'stepVerified'],
      ['s7', 'stepSkipped'],
      ['s8', 'stepStarted'],
      ['s8', 'stepVerified'],
      ['s9', 'stepStarted'],
      ['s9', 'stepVerified'],
      ['s10', 'stepStarted'],
      ['s10', 'stepVerified'],
      ['s11', 'stepStarted'],
      ['s11', 'stepVerified'],
      ['s12', 'stepStarted'],
      ['s12', 'stepVerified'],
      ['s13', 'stepStarted'],
      ['s13', 'stepVerified'],
      ['s14', 'stepStarted'],
      ['s14', 'stepVerified'],
    ]);
    expect(fx.events.filter((e) => e.kind === 'stepSkipped')).toEqual([
      { stepId: 's5', kind: 'stepSkipped', reason: 'noValue' },
      { stepId: 's7', kind: 'stepSkipped', reason: 'noValue' },
    ]);
    expect(report.counts).toEqual({ verified: 13, failed: 0, skipped: 2 });
    expect(report.aborted).toBe(false);
    expect(fx.events).toMatchSnapshot();
  });
});
