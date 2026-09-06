import { expect, test } from '@playwright/test';
import { FakeApiClient } from '@fib/api-client';
import { normalise } from '@fib/core';
import type { FillEvent, FillStep } from '@fib/contracts';
import { PlaywrightDriver } from '../../driver-playwright/src/index.js';
import { registry, type MatchOptionResult } from '../../adapters/src/index.js';
import { A11yFallbackAgent, Executor } from '../src/index.js';
import { FIXTURE_PAGE_URL, launchChromiumOverCdp, type LaunchedChromium } from './cdp-launcher';

let launched: LaunchedChromium;
let driver: PlaywrightDriver;

test.beforeEach(async () => {
  launched = await launchChromiumOverCdp();
  driver = new PlaywrightDriver();
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.waitFor({ css: '#model' }, 'attached', 15_000);
});

test.afterEach(async () => {
  await driver?.close();
  await launched?.stop();
});

// Test-local matcher: exact tier -> normalised tier -> no match. The fallback
// loop under test never fills a select, so the fuzzy/LLM tiers are out of scope.
async function matchOption(wanted: string, options: string[]): Promise<MatchOptionResult> {
  const exact = options.indexOf(wanted);
  if (exact >= 0) return { index: exact, via: 'exact', confidence: 1 };
  const index = options.findIndex((option) => normalise(option) === normalise(wanted));
  if (index >= 0) return { index, via: 'exact', confidence: 0.9 };
  return { index: null, via: 'exact', confidence: 0 };
}

function makeExecutor(api: FakeApiClient): Executor {
  return new Executor({
    driver,
    registry,
    matchOption,
    fallback: new A11yFallbackAgent({ api }),
    // One deterministic attempt, then straight to the fallback agent.
    retry: { attempts: 1, backoffMs: [0] },
    neverClick: [],
    profiles: {},
  });
}

/**
 * A fill step for `dealAmount` whose deterministic fill can never succeed: the
 * step declares the wrong widget spec (control `date`, whose adapter rejects
 * "1250000" before touching the DOM). The locator itself still resolves to the
 * real input because the T19 executor re-verifies through this same locator
 * after the agent reports `done` — a locator that misses the input would fail
 * that verification too.
 */
function dealAmountStep(): FillStep {
  return {
    stepId: 's0',
    kind: 'fillField',
    sectionId: 'deal',
    fieldId: 'dealAmount',
    control: 'date',
    locator: { css: 'input[formcontrolname="dealAmount"]' },
    value: '1250000',
    valueType: 'string',
  } as FillStep;
}

/** Resolves the live a11y ref of the dealAmount input from a snapshot. */
async function resolveDealAmountRef(): Promise<string> {
  const { yaml } = await driver.ariaSnapshot();
  const line = yaml.split('\n').find((candidate) => candidate.includes('textbox "Deal amount"'));
  const ref = /\[ref=(e\d+)\]/.exec(line ?? '')?.[1];
  if (!ref) throw new Error(`dealAmount ref not found in snapshot:\n${yaml}`);
  return ref;
}

async function modelText(): Promise<string> {
  return driver.readText({ css: '#model' });
}

test('AC1: broken deterministic fill recovers through the a11y agent loop', async () => {
  const api = new FakeApiClient();
  // The test resolves the real ref for the input from a snapshot, then scripts
  // the service: type → press Enter → readValue → done.
  const ref = await resolveDealAmountRef();
  api.queueAgentSteps([
    { tool: 'type', ref, text: '1250000' },
    { tool: 'press', ref, key: 'Enter' },
    { tool: 'readValue', ref },
    { tool: 'done', value: '1250000' },
  ]);

  const events: FillEvent[] = [];
  const report = await makeExecutor(api).run({ steps: [dealAmountStep()] }, (e) => events.push(e));

  expect(events.map((e) => [e.stepId, e.kind])).toEqual([
    ['s0', 'stepStarted'],
    ['s0', 'stepRetrying'],
    ['s0', 'stepFallback'],
    ['s0', 'stepVerified'],
  ]);
  expect(events[3]).toMatchObject({ stepId: 's0', via: 'agent' });
  expect(report.steps[0]).toMatchObject({ status: 'verified', via: 'agent' });
  expect(report.aborted).toBe(false);

  // The agent typed into the live form through refs and the model registered it.
  await expect.poll(modelText).toContain('"dealAmount":"1250000"');
  const agentCalls = api.calls.filter((call) => call.method === 'agentStep');
  expect(agentCalls).toHaveLength(4);
  // The loop snapshots the history at call time: call 1 empty, the last call
  // sees the three prior actions + outcomes.
  expect(agentCalls[0]).toMatchObject({
    method: 'agentStep',
    req: {
      goal: 'Set field dealAmount to 1250000',
      a11ySnapshot: expect.stringContaining('textbox "Deal amount"'),
    },
  });
  expect(agentCalls[3]?.req.goal).toBe('Set field dealAmount to 1250000');
  // FakeApiClient stores the request by reference and the agent reuses one
  // history array, so the recorded history of every call converges on the
  // full run: the three queued non-terminal actions with their observations.
  expect(agentCalls[3]?.req.history).toEqual([
    { toolCall: { tool: 'type', ref, text: '1250000' }, observation: 'typed "1250000"' },
    { toolCall: { tool: 'press', ref, key: 'Enter' }, observation: 'pressed Enter' },
    { toolCall: { tool: 'readValue', ref }, observation: 'read "1250000"' },
  ]);
});

test('AC2: giveUp from the service fails the step with the given reason', async () => {
  const api = new FakeApiClient();
  api.queueAgentSteps([{ tool: 'giveUp', reason: 'cannot find the field' }]);

  const events: FillEvent[] = [];
  const report = await makeExecutor(api).run({ steps: [dealAmountStep()] }, (e) => events.push(e));

  expect(events.map((e) => [e.stepId, e.kind])).toEqual([
    ['s0', 'stepStarted'],
    ['s0', 'stepRetrying'],
    ['s0', 'stepFallback'],
    ['s0', 'stepFailed'],
  ]);
  expect(events[3]).toMatchObject({ stepId: 's0', reason: 'cannot find the field' });
  expect(report.steps[0]).toMatchObject({ status: 'failed', reason: 'cannot find the field' });
  expect(report.counts).toEqual({ verified: 0, failed: 1, skipped: 0 });
  await expect.poll(modelText).toContain('"dealAmount":""');
});
