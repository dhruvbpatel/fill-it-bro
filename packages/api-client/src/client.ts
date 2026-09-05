import type {
  AgentStepRequest,
  AgentStepResponse,
  ExtractionRequest,
  ExtractionResult,
  MatchOptionRequest,
  MatchOptionResponse,
  RunLogEvent,
} from '@fib/contracts';

export interface ApiClient {
  extract(req: ExtractionRequest): Promise<ExtractionResult>;
  agentStep(req: AgentStepRequest): Promise<AgentStepResponse>;
  matchOption(req: MatchOptionRequest): Promise<MatchOptionResponse>;
  startRun(meta: {
    user: string;
    formId: string;
    dealId: string;
    sources: string[];
  }): Promise<{ runId: string }>;
  logEvent(runId: string, event: RunLogEvent): Promise<void>;
}

/** Non-2xx responses carry `{status, body}`; network failures carry `{status: 0}`. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `ApiError ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? fetch;
  }

  extract(req: ExtractionRequest): Promise<ExtractionResult> {
    return this.post<ExtractionResult>('/extract', req);
  }

  agentStep(req: AgentStepRequest): Promise<AgentStepResponse> {
    return this.post<AgentStepResponse>('/agent/step', req);
  }

  matchOption(req: MatchOptionRequest): Promise<MatchOptionResponse> {
    return this.post<MatchOptionResponse>('/match-option', req);
  }

  startRun(meta: {
    user: string;
    formId: string;
    dealId: string;
    sources: string[];
  }): Promise<{ runId: string }> {
    return this.post<{ runId: string }>('/runs', meta);
  }

  async logEvent(runId: string, event: RunLogEvent): Promise<void> {
    await this.post<unknown>(`/runs/${encodeURIComponent(runId)}/events`, event);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new ApiError(
          response.status,
          text === '' ? undefined : parseBody(text),
          `POST ${path} failed with HTTP ${response.status}`,
        );
      }
      return (text === '' ? undefined : parseBody(text)) as T;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(
        0,
        undefined,
        `POST ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}
