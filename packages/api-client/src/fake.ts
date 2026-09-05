import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentStepRequest,
  AgentStepResponse,
  ExtractionRequest,
  ExtractionResult,
  MatchOptionRequest,
  MatchOptionResponse,
  RunLogEvent,
} from '@fib/contracts';
import type { ApiClient } from './client.js';

export type FakeCall =
  | { method: 'extract'; req: ExtractionRequest }
  | { method: 'agentStep'; req: AgentStepRequest }
  | { method: 'matchOption'; req: MatchOptionRequest }
  | {
      method: 'startRun';
      meta: { user: string; formId: string; dealId: string; sources: string[] };
    }
  | { method: 'logEvent'; runId: string; event: RunLogEvent };

/**
 * In-memory ApiClient serving canned JSON from `fixtures/` so desktop and panel
 * tests run without the Python service. `agentStep` drains a queue set via
 * `queueAgentSteps` before falling back to `fixtures/agent-step.json`.
 */
export class FakeApiClient implements ApiClient {
  readonly calls: FakeCall[] = [];
  private readonly agentStepQueue: AgentStepResponse[] = [];
  private readonly fixturesDir: string;
  private runCounter = 0;

  constructor(fixturesDir?: string) {
    this.fixturesDir = fixturesDir ?? path.resolve(import.meta.dirname, '../fixtures');
  }

  queueAgentSteps(steps: AgentStepResponse[]): void {
    this.agentStepQueue.push(...steps);
  }

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    this.calls.push({ method: 'extract', req });
    return this.loadFixture<ExtractionResult>('extract');
  }

  async agentStep(req: AgentStepRequest): Promise<AgentStepResponse> {
    this.calls.push({ method: 'agentStep', req });
    return this.agentStepQueue.shift() ?? this.loadFixture<AgentStepResponse>('agent-step');
  }

  async matchOption(req: MatchOptionRequest): Promise<MatchOptionResponse> {
    this.calls.push({ method: 'matchOption', req });
    return this.loadFixture<MatchOptionResponse>('match-option');
  }

  async startRun(meta: {
    user: string;
    formId: string;
    dealId: string;
    sources: string[];
  }): Promise<{ runId: string }> {
    this.calls.push({ method: 'startRun', meta });
    this.runCounter += 1;
    return { runId: `fake-run-${this.runCounter}` };
  }

  async logEvent(runId: string, event: RunLogEvent): Promise<void> {
    this.calls.push({ method: 'logEvent', runId, event });
  }

  private loadFixture<T>(name: string): T {
    return JSON.parse(readFileSync(path.join(this.fixturesDir, `${name}.json`), 'utf-8')) as T;
  }
}
