import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeApiClient, type ApiClient } from '@fib/api-client';
import type {
  AgentStepResponse,
  ExtractionRequest,
  ExtractionResult,
  MatchOptionRequest,
  MatchOptionResponse,
  RunLogEvent,
} from '@fib/contracts';
import type { BrowserDriver, FormBundle, LocatorSpec, SessionSnapshot } from '@fib/core';
import { loadFormBundle } from '@fib/core';
import { createApiClient, SessionController } from './SessionController.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_CONFIGS = resolve(__dirname, '../../../../configs');
const EXTRACT_FIXTURE = resolve(__dirname, '../../../../packages/api-client/fixtures/extract.json');

// ---------------------------------------------------------------------------
// In-memory fake form + driver: just enough behaviour for the real adapters.
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = ['Issuer', 'Agent', 'Guarantor'];

/** Cell writes arrive as `{within: <cell spec>, css: 'input, select'}`; key them by the cell css. */
function cellKeyOf(t: LocatorSpec): string {
  const inner = t.within?.css ?? '';
  if (inner.includes('.ag-cell')) return inner;
  const own = t.css ?? '';
  return own.includes('.ag-cell') ? own : '';
}

class FakeFormDriver implements BrowserDriver {
  connectedWith: { cdpUrl: string; pageUrl: RegExp } | null = null;
  neverClick: LocatorSpec[] = [];
  private values = new Map<string, string>();

  async connect(cdpUrl: string, pageUrl: RegExp): Promise<void> {
    this.connectedWith = { cdpUrl, pageUrl };
  }
  setNeverClick(patterns: LocatorSpec[]): void {
    this.neverClick = patterns;
  }
  async click(): Promise<void> {}
  async type(t: LocatorSpec, text: string): Promise<void> {
    if (t.css === '.fib-select__search') this.values.set('issuerName', text);
    const cell = cellKeyOf(t);
    if (cell) this.values.set(cell, text);
  }
  async fill(t: LocatorSpec, text: string): Promise<void> {
    await this.type(t, text);
  }
  async selectByLabel(t: LocatorSpec, label: string): Promise<void> {
    this.values.set(cellKeyOf(t), label);
  }
  async press(): Promise<void> {}
  async readValue(t: LocatorSpec): Promise<string | null> {
    return this.readText(t);
  }
  async readText(t: LocatorSpec): Promise<string> {
    if (t.css === '.fib-select__option') return 'Goldman Sachs Incorporated';
    if (t.css === 'option') return ROLE_OPTIONS[t.nth ?? 0] ?? '';
    if (t.css === '.fib-select__value') return this.values.get('issuerName') ?? '';
    const cell = cellKeyOf(t);
    return cell ? (this.values.get(cell) ?? '') : '';
  }
  async count(t: LocatorSpec): Promise<number> {
    if (t.css === '.fib-select__option') return 1;
    if (t.css === 'option') return ROLE_OPTIONS.length;
    if (t.css === '.ag-row') return 1;
    if (t.css === '.fib-select__value') return this.values.has('issuerName') ? 1 : 0;
    return 1;
  }
  async waitFor(): Promise<void> {}
  async waitStable(): Promise<void> {}
  async ariaSnapshot(): Promise<{ yaml: string; refs: string[] }> {
    return { yaml: '', refs: [] };
  }
}

// ---------------------------------------------------------------------------
// Stub ApiClient serving the canned extraction result.
// ---------------------------------------------------------------------------

class StubApi implements ApiClient {
  readonly startCalls: { user: string; formId: string; dealId: string; sources: string[] }[] = [];
  readonly events: RunLogEvent[] = [];
  readonly extractCalls: ExtractionRequest[] = [];

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    this.extractCalls.push(req);
    return JSON.parse(readFileSync(EXTRACT_FIXTURE, 'utf-8')) as ExtractionResult;
  }
  async agentStep(): Promise<AgentStepResponse> {
    return { tool: 'giveUp', reason: 'not expected in this test' };
  }
  async matchOption(req: MatchOptionRequest): Promise<MatchOptionResponse> {
    const index = req.options.indexOf(req.wanted);
    return { index: index === -1 ? null : index, confidence: 1, reason: 'stub exact' };
  }
  async startRun(meta: {
    user: string;
    formId: string;
    dealId: string;
    sources: string[];
  }): Promise<{ runId: string }> {
    this.startCalls.push(meta);
    return { runId: 'run-1' };
  }
  async logEvent(runId: string, event: RunLogEvent): Promise<void> {
    this.events.push({ ...event, runId });
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface PanelPush {
  channel: string;
  payload: unknown;
}

function makeHarness() {
  const bundle: FormBundle = loadFormBundle(REPO_CONFIGS, 'fixtureDeal');
  const driver = new FakeFormDriver();
  const api = new StubApi();
  const panel: PanelPush[] = [];
  let loadListener: (() => void) | null = null;
  let url = 'about:blank';

  const controller = new SessionController({
    dealId: '1',
    bundle,
    formView: {
      webContents: {
        on(event, listener) {
          if (event === 'did-finish-load') loadListener = listener;
          return undefined;
        },
        isLoading: () => false,
        getURL: () => url,
      },
    },
    panelView: { webContents: { send: (channel, payload) => panel.push({ channel, payload }) } },
    getCdpUrl: () => 'http://127.0.0.1:9999',
    api,
    ingestFiles: async () => ({
      documentSet: {
        setId: 'set-1',
        sources: [
          { sourceId: 'body', kind: 'emailBody', name: 'sample.msg', mime: 'message/rfc822' },
        ],
        manifest: [{ mergedPage: 1, sourceId: 'body', sourcePage: 1 }],
        pages: [
          {
            mergedPage: 1,
            width: 612,
            height: 792,
            items: [
              { id: 'p1i0', text: 'Please onboard', x: 1, y: 1, w: 10, h: 10 },
              { id: 'p1i1', text: 'Goldman Sachs Incorporated', x: 1, y: 12, w: 90, h: 10 },
              { id: 'p1i2', text: 'Issuer', x: 1, y: 23, w: 30, h: 10 },
            ],
          },
        ],
      },
      mergedPdf: new TextEncoder().encode('%PDF-fake').buffer as ArrayBuffer,
    }),
    findPhrase: (set, phrase) => {
      const needle = phrase.toLowerCase();
      const hits: { mergedPage: number; itemIds: string[] }[] = [];
      for (const page of set.pages) {
        const ids = page.items
          .filter((item) => item.text.toLowerCase().includes(needle))
          .map((item) => item.id);
        if (ids.length > 0) hits.push({ mergedPage: page.mergedPage, itemIds: ids });
      }
      return hits;
    },
    driver,
  });

  return {
    driver,
    api,
    panel,
    controller,
    bundle,
    formLoaded: (loadedUrl: string) => {
      url = loadedUrl;
      loadListener?.();
    },
  };
}

const FORM_URL = 'http://localhost:4300/deal/1';

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('SessionController', () => {
  it('broadcasts every reduced snapshot on session:snapshot', () => {
    const { panel, controller, formLoaded } = makeHarness();
    expect(controller.currentSnapshot().state).toBe('launching');
    expect(panel.map((p) => (p.payload as SessionSnapshot).state)).toEqual(['launching']);
    expect(panel[0]?.payload).toMatchObject({ dealId: '1', formId: 'fixtureDeal' });

    formLoaded(FORM_URL);
    expect(controller.currentSnapshot().state).toBe('formReady');
    expect(panel.map((p) => (p.payload as SessionSnapshot).state)).toEqual([
      'launching',
      'formReady',
    ]);
  });

  it('connects the driver once at formReady against the CDP endpoint', () => {
    const { driver, controller, formLoaded } = makeHarness();
    formLoaded(FORM_URL);
    expect(controller.currentSnapshot().state).toBe('formReady');
    expect(driver.connectedWith?.cdpUrl).toBe('http://127.0.0.1:9999');
    expect(driver.connectedWith?.pageUrl.test(FORM_URL)).toBe(true);
  });

  it('ignores did-finish-load on URLs outside the form template', () => {
    const { panel, formLoaded } = makeHarness();
    formLoaded('http://localhost:4300/other/page');
    expect(panel.map((p) => (p.payload as SessionSnapshot).state)).toEqual(['launching']);
  });

  it(
    'runs the full loop: ingest -> extract -> resolve -> fill -> review',
    { timeout: 60_000 },
    async () => {
      const { panel, driver, api, controller, formLoaded } = makeHarness();
      formLoaded(FORM_URL);
      controller.filesDropped(['/tmp/sample.msg']);
      await until(() => controller.currentSnapshot().state === 'review', 'review');
      await until(() => api.events.at(-1)?.kind === 'runFinished', 'runFinished log');

      // Run log opened at ingesting with the dropped file names.
      expect(api.startCalls).toEqual([
        { user: expect.any(String), formId: 'fixtureDeal', dealId: '1', sources: ['sample.msg'] },
      ]);

      // Extraction request groups DocumentSet pages by manifest source.
      expect(api.extractCalls).toHaveLength(1);
      expect(api.extractCalls[0]?.formId).toBe('fixtureDeal');
      expect(api.extractCalls[0]?.sources).toEqual([
        {
          sourceId: 'body',
          pages: [
            {
              mergedPage: 1,
              items: [
                { id: 'p1i0', text: 'Please onboard' },
                { id: 'p1i1', text: 'Goldman Sachs Incorporated' },
                { id: 'p1i2', text: 'Issuer' },
              ],
            },
          ],
        },
      ]);

      // Panel fields: scalars keep their ids, grid cells are addressed group[row].col.
      const final = controller.currentSnapshot();
      expect(final.fields.map((f) => f.fieldId)).toEqual([
        'issuerName',
        'settlementDate',
        'parties[0].partyName',
        'parties[0].role',
      ]);

      // Fill events are translated to the panel's step-id convention.
      const stepIds = final.fillEvents.map((e) => e.stepId);
      expect(stepIds).toContain('fillField:issuerName');
      expect(stepIds).toContain('fillField:settlementDate');
      expect(stepIds).toContain('fillCell:parties[0].partyName');
      expect(stepIds).toContain('fillCell:parties[0].role');

      // Every field with a value verified; guard rails reached the driver.
      expect(driver.neverClick.length).toBeGreaterThan(0);
      expect(final.fillEvents.filter((e) => e.kind === 'stepFailed')).toEqual([]);
      // Verified: Deal tab, Add fees reveal, issuerName, Parties tab, both party cells.
      expect(final.fillEvents.filter((e) => e.kind === 'stepVerified')).toHaveLength(6);

      // Run log: one event per fill event plus a final runFinished; payload keys stay in ticket-09's allow-list.
      const allowed = new Set([
        'fieldId',
        'status',
        'via',
        'confidence',
        'quote',
        'reason',
        'attempt',
        'sourceId',
        'mergedPage',
      ]);
      expect(api.events.length).toBeGreaterThanOrEqual(final.fillEvents.length);
      expect(api.events.at(-1)?.kind).toBe('runFinished');
      for (const event of api.events) {
        expect(event.runId).toBe('run-1');
        for (const key of Object.keys(event.payload)) {
          expect(allowed.has(key), `unexpected payload key ${key}`).toBe(true);
        }
      }

      // The merged pdf from ingest is served to the viewer.
      expect(Buffer.from(controller.getMergedPdf()).toString('latin1')).toContain('%PDF-fake');
      expect(panel.at(-1)?.payload).toMatchObject({ state: 'review' });
    },
  );

  it('ignores an illegal second filesDropped instead of throwing', async () => {
    const { controller, formLoaded } = makeHarness();
    formLoaded(FORM_URL);
    controller.filesDropped(['/tmp/sample.msg']);
    await until(() => controller.currentSnapshot().state === 'ingesting', 'ingesting');
    controller.filesDropped(['/tmp/again.msg']);
    await new Promise((r) => setTimeout(r, 50));
    // The second drop is not a legal transition from ingesting: ignored, no failure.
    expect(controller.currentSnapshot().state).not.toBe('failed');
    expect(controller.currentSnapshot().error).toBeUndefined();
  });

  it('fails the session with a readable reason when a stage throws', async () => {
    const harness = makeHarness();
    harness.formLoaded(FORM_URL);
    interface IngestInjectable {
      deps: { ingestFiles: () => Promise<never> };
    }
    (harness.controller as unknown as IngestInjectable).deps.ingestFiles = () =>
      Promise.reject(new Error('ingest worker crashed'));
    harness.controller.filesDropped(['/tmp/sample.msg']);
    await until(() => harness.controller.currentSnapshot().state === 'failed', 'failed');
    expect(harness.controller.currentSnapshot().error).toBe('ingest worker crashed');
    expect(harness.panel.at(-1)?.payload).toMatchObject({
      state: 'failed',
      error: 'ingest worker crashed',
    });
  });
});

describe('createApiClient', () => {
  it('returns FakeApiClient when FIB_API=fake', () => {
    expect(createApiClient({ FIB_API: 'fake' })).toBeInstanceOf(FakeApiClient);
  });

  it('posts to FIB_SERVICE_URL, defaulting to http://localhost:8787', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      await createApiClient({ FIB_SERVICE_URL: 'http://svc:9000/' }).startRun({
        user: 'u',
        formId: 'f',
        dealId: 'd',
        sources: [],
      });
      await createApiClient({}).startRun({ user: 'u', formId: 'f', dealId: 'd', sources: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(urls).toEqual(['http://svc:9000/runs', 'http://localhost:8787/runs']);
  });
});
