import type {
  AgentStepRequest,
  ExtractionRequest,
  MatchOptionRequest,
  RunLogEvent,
} from '@fib/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, HttpApiClient } from './client';

const BASE = 'http://127.0.0.1:8787';

const extractionRequest: ExtractionRequest = {
  formId: 'fixtureDeal',
  sources: [
    {
      sourceId: 'src1',
      pages: [{ mergedPage: 3, items: [{ id: 'p3i17', text: 'Goldman Sachs' }] }],
    },
  ],
};

const extractionResult = {
  runId: 'run1',
  fields: [
    {
      fieldId: 'issuerName',
      value: 'Goldman Sachs Incorporated',
      valueType: 'string',
      status: 'found',
      confidence: 0.95,
      sourceId: 'src1',
      citations: [{ itemIds: ['p3i17'], quote: 'Goldman Sachs' }],
      reason: null,
    },
  ],
  groups: [],
};

const agentStepRequest: AgentStepRequest = {
  goal: 'Fill dealAmount',
  fieldSpec: { fieldId: 'dealAmount', description: 'Deal amount', expectedType: 'number' },
  a11ySnapshot: '- textbox "Deal amount"',
  history: [],
};

const agentStepResponse = { tool: 'type', ref: 'e12', text: '1000000' };

const matchOptionRequest: MatchOptionRequest = {
  wanted: 'Goldman Sachs',
  options: ['Goldman Sachs Incorporated', 'Goldman Sachs Asset Mgmt'],
};

const matchOptionResponse = { index: 0, confidence: 0.87, reason: 'closest token overlap' };

const runMeta = { user: 'dhruv', formId: 'fixtureDeal', dealId: 'D-1', sources: ['email.msg'] };

const runLogEvent: RunLogEvent = {
  runId: 'run1',
  ts: '2026-09-04T10:00:00Z',
  user: 'dhruv',
  kind: 'runStarted',
  payload: { formId: 'fixtureDeal' },
};

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(replies: Array<Response | Error>): { impl: typeof fetch; seen: Recorded[] } {
  const seen: Recorded[] = [];
  let call = 0;
  const impl: typeof fetch = (input, init) => {
    seen.push({ url: String(input), init });
    const reply = replies[call];
    call += 1;
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(reply);
  };
  return { impl, seen };
}

function sentBody(rec: Recorded): unknown {
  return JSON.parse(String(rec.init?.body)) as unknown;
}

describe('HttpApiClient', () => {
  it('extract posts to /extract and returns the parsed result', async () => {
    const { impl, seen } = stubFetch([jsonResponse(200, extractionResult)]);
    const client = new HttpApiClient(BASE, impl);

    await expect(client.extract(extractionRequest)).resolves.toEqual(extractionResult);

    expect(seen[0]?.url).toBe(`${BASE}/extract`);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(sentBody(seen[0]!)).toEqual(extractionRequest);
    expect(new Headers(seen[0]?.init?.headers).get('content-type')).toBe('application/json');
  });

  it('agentStep posts to /agent/step and returns the parsed result', async () => {
    const { impl, seen } = stubFetch([jsonResponse(200, agentStepResponse)]);
    const client = new HttpApiClient(BASE, impl);

    await expect(client.agentStep(agentStepRequest)).resolves.toEqual(agentStepResponse);

    expect(seen[0]?.url).toBe(`${BASE}/agent/step`);
    expect(sentBody(seen[0]!)).toEqual(agentStepRequest);
  });

  it('matchOption posts to /match-option and returns the parsed result', async () => {
    const { impl, seen } = stubFetch([jsonResponse(200, matchOptionResponse)]);
    const client = new HttpApiClient(BASE, impl);

    await expect(client.matchOption(matchOptionRequest)).resolves.toEqual(matchOptionResponse);

    expect(seen[0]?.url).toBe(`${BASE}/match-option`);
    expect(sentBody(seen[0]!)).toEqual(matchOptionRequest);
  });

  it('startRun posts meta to /runs and returns the runId', async () => {
    const { impl, seen } = stubFetch([jsonResponse(201, { runId: 'r9' })]);
    const client = new HttpApiClient(BASE, impl);

    await expect(client.startRun(runMeta)).resolves.toEqual({ runId: 'r9' });

    expect(seen[0]?.url).toBe(`${BASE}/runs`);
    expect(sentBody(seen[0]!)).toEqual(runMeta);
  });

  it('logEvent posts the event to /runs/{id}/events and resolves', async () => {
    const { impl, seen } = stubFetch([new Response(null, { status: 204 })]);
    const client = new HttpApiClient(BASE, impl);

    await expect(client.logEvent('run1', runLogEvent)).resolves.toBeUndefined();

    expect(seen[0]?.url).toBe(`${BASE}/runs/run1/events`);
    expect(sentBody(seen[0]!)).toEqual(runLogEvent);
  });

  it('encodes the runId into the events path', async () => {
    const { impl, seen } = stubFetch([new Response(null, { status: 204 })]);
    const client = new HttpApiClient(BASE, impl);

    await client.logEvent('run 1', runLogEvent);

    expect(seen[0]?.url).toBe(`${BASE}/runs/run%201/events`);
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { impl, seen } = stubFetch([jsonResponse(200, extractionResult)]);
    const client = new HttpApiClient(`${BASE}/`, impl);

    await client.extract(extractionRequest);

    expect(seen[0]?.url).toBe(`${BASE}/extract`);
  });

  it('maps non-2xx JSON responses to ApiError with status and parsed body', async () => {
    const { impl } = stubFetch([jsonResponse(500, { detail: 'boom' })]);
    const client = new HttpApiClient(BASE, impl);

    const err = await client.extract(extractionRequest).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(500);
    expect(apiErr.body).toEqual({ detail: 'boom' });
  });

  it('maps non-2xx plain-text responses to ApiError keeping the raw body', async () => {
    const { impl } = stubFetch([
      new Response('gateway broke', { status: 502, headers: { 'content-type': 'text/plain' } }),
    ]);
    const client = new HttpApiClient(BASE, impl);

    const err = await client.matchOption(matchOptionRequest).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).body).toBe('gateway broke');
  });

  it('maps network failures to ApiError with status 0', async () => {
    const { impl } = stubFetch([new TypeError('fetch failed')]);
    const client = new HttpApiClient(BASE, impl);

    const err = await client.agentStep(agentStepRequest).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.body).toBeUndefined();
    expect(apiErr.message).toContain('fetch failed');
  });
});
