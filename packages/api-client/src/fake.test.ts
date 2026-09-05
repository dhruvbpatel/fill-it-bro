import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentStepResponse } from '@fib/contracts';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from './client';
import { FakeApiClient } from './fake';

const SCHEMAS_DIR = path.resolve(import.meta.dirname, '../../contracts/schemas');
const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures');

// Same $ref handling as packages/contracts/src/roundtrip.test.ts: cross-file refs
// are plain relative filenames, and $id is stripped so Ajv resolves against them.
function loadSchema(name: string): object {
  const raw = JSON.parse(readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), 'utf-8')) as {
    $id?: string;
  };
  delete raw.$id;
  return raw;
}

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as unknown;
}

async function compile(name: string): Promise<(data: unknown) => boolean> {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: true,
    loadSchema: async (uri: string) => loadSchema(uri.replace(/\.schema\.json$/, '')),
  });
  return (await ajv.compileAsync(loadSchema(name))) as (data: unknown) => boolean;
}

describe('FakeApiClient fixtures validate against contracts schemas', () => {
  it.each([
    ['extract', 'extraction-result'],
    ['agent-step', 'agent-step-response'],
    ['match-option', 'match-option-response'],
  ])('%s.json validates against %s', async (fixture, schema) => {
    const validate = await compile(schema);
    const example = loadFixture(fixture);
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });
});

const apiClient = (): ApiClient => new FakeApiClient();

describe('FakeApiClient', () => {
  it('extract serves fixtures/extract.json', async () => {
    const fake = new FakeApiClient();
    await expect(fake.extract({ formId: 'fixtureDeal', sources: [] })).resolves.toEqual(
      loadFixture('extract'),
    );
  });

  it('matchOption serves fixtures/match-option.json', async () => {
    const fake = new FakeApiClient();
    await expect(
      fake.matchOption({ wanted: 'Goldman Sachs', options: ['Goldman Sachs Incorporated'] }),
    ).resolves.toEqual(loadFixture('match-option'));
  });

  it('agentStep serves fixtures/agent-step.json when the queue is empty', async () => {
    const fake = new FakeApiClient();
    await expect(
      fake.agentStep({
        goal: 'fill',
        fieldSpec: { fieldId: 'dealAmount', description: 'amount' },
        a11ySnapshot: '',
        history: [],
      }),
    ).resolves.toEqual(loadFixture('agent-step'));
  });

  it('agentStep drains the queue set via queueAgentSteps before falling back', async () => {
    const fake = new FakeApiClient();
    const queued: AgentStepResponse[] = [
      { tool: 'click', ref: 'e3' },
      { tool: 'done', value: '1000000' },
    ];
    fake.queueAgentSteps(queued);

    const req = {
      goal: 'fill',
      fieldSpec: { fieldId: 'dealAmount', description: 'amount' },
      a11ySnapshot: '',
      history: [],
    };
    await expect(fake.agentStep(req)).resolves.toEqual(queued[0]);
    await expect(fake.agentStep(req)).resolves.toEqual(queued[1]);
    await expect(fake.agentStep(req)).resolves.toEqual(loadFixture('agent-step'));
  });

  it('startRun returns a fresh runId per call', async () => {
    const fake = new FakeApiClient();
    const meta = { user: 'dhruv', formId: 'fixtureDeal', dealId: 'D-1', sources: ['a.pdf'] };
    await expect(fake.startRun(meta)).resolves.toEqual({ runId: 'fake-run-1' });
    await expect(fake.startRun(meta)).resolves.toEqual({ runId: 'fake-run-2' });
  });

  it('logEvent resolves and records the call', async () => {
    const fake = new FakeApiClient();
    const event = {
      runId: 'fake-run-1',
      ts: '2026-09-04T10:00:00Z',
      user: 'dhruv',
      kind: 'runStarted',
      payload: { formId: 'fixtureDeal' },
    };
    await expect(fake.logEvent('fake-run-1', event)).resolves.toBeUndefined();
    expect(fake.calls).toEqual([{ method: 'logEvent', runId: 'fake-run-1', event }]);
  });

  it('records every call in calls[]', async () => {
    const fake = apiClient();
    const extractReq = { formId: 'fixtureDeal', sources: [] };
    const agentReq = {
      goal: 'fill',
      fieldSpec: { fieldId: 'dealAmount', description: 'amount' },
      a11ySnapshot: '',
      history: [],
    };
    const matchReq = { wanted: 'Goldman Sachs', options: ['Goldman Sachs Incorporated'] };
    const meta = { user: 'dhruv', formId: 'fixtureDeal', dealId: 'D-1', sources: ['a.pdf'] };
    const event = {
      runId: 'fake-run-1',
      ts: '2026-09-04T10:00:00Z',
      user: 'dhruv',
      kind: 'runStarted',
      payload: {},
    };

    await fake.extract(extractReq);
    await fake.agentStep(agentReq);
    await fake.matchOption(matchReq);
    await fake.startRun(meta);
    await fake.logEvent('fake-run-1', event);

    expect(fake.calls).toEqual([
      { method: 'extract', req: extractReq },
      { method: 'agentStep', req: agentReq },
      { method: 'matchOption', req: matchReq },
      { method: 'startRun', meta },
      { method: 'logEvent', runId: 'fake-run-1', event },
    ]);
  });
});
