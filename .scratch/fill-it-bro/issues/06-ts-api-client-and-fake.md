# 06: TS api-client + fake

**What to build:** A typed TypeScript client for every service endpoint, plus an in-memory fake that serves fixture JSON so every desktop and panel test runs without the Python service.

**Blocked by:** 02 (Contracts + codegen)

**Status:** done

## Read first
- PLAN.md §7 endpoints, §15 conventions.

## Do exactly this
- `packages/api-client/src/client.ts`:
  ```ts
  export interface ApiClient {
    extract(req: ExtractionRequest): Promise<ExtractionResult>;
    agentStep(req: AgentStepRequest): Promise<AgentStepResponse>;
    matchOption(req: MatchOptionRequest): Promise<MatchOptionResponse>;
    startRun(meta: { user: string; formId: string; dealId: string; sources: string[] }): Promise<{ runId: string }>;
    logEvent(runId: string, event: RunLogEvent): Promise<void>;
  }
  export class HttpApiClient implements ApiClient { constructor(baseUrl: string, fetchImpl?: typeof fetch) }
  ```
  Errors: non-2xx → throw `ApiError { status, body }`; network failure → `ApiError { status: 0 }`.
- `packages/api-client/src/fake.ts`: `FakeApiClient` reading `packages/api-client/fixtures/{extract,agent-step,match-option}.json`; `agentStep` returns responses from a queue set via `fake.queueAgentSteps([...])`; records every call in `fake.calls[]`.
- Fixtures must validate against the contracts schemas (test with Ajv).

## Acceptance criteria
- [x] Unit tests cover each method's happy path and `ApiError` mapping using a stubbed `fetch`.
- [x] `FakeApiClient` fixtures validate against schemas.
- [x] Package has zero runtime dependencies besides `@fib/contracts`.
