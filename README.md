# Fill-It-Bro

Agentic web-form filling with citations. A user launches the portable Windows EXE with
a deal id; the app opens the deal's Angular web form (SSO) in an Electron window with a
side panel. Drop a PDF or an Outlook `.msg` into the panel: the app parses it locally,
asks an LLM (through the internal gateway, via a Python service) to extract the form's
fields **with citations**, fills the form through Playwright, and shows a field list.
Clicking a field jumps the PDF viewer to the exact highlighted source text. The human
reviews and clicks Submit themselves — submission is never automated.

Two brains, one contract:

```
┌──────────────────────── Electron (Windows EXE) ────────────────────────┐
│  host-electron (main)                                                   │
│   ├─ ingest (utility process): .msg split → merged PDF + manifest       │
│   │                            LiteParse → pages[].textItems[]           │
│   ├─ fill-engine: planner → executor → adapters → verify → fallback     │
│   │      └─ BrowserDriver (Playwright over CDP to own WebContentsView)  │
│   ├─ session: state machine, events, run log client                     │
│   └─ api-client → Python service                                        │
│  panel (React, renderer): upload, field list, PDF viewer w/ highlights  │
│  WebContentsView: the deal form (SSO)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                 │ HTTPS (JSON only: text items, schemas, a11y snapshots)
┌────────────────▼──── Python service (FastAPI) ─────────────────────────┐
│  /extract      schema-driven structured output, per source document     │
│  /agent/step   one step of the fill fallback loop (a11y tree → action)  │
│  /match-option semantic dropdown option choice                          │
│  /runs         run-log sink                                             │
│  LLMProvider: OpenAI SDK → internal gateway (Claude-compatible later)   │
└─────────────────────────────────────────────────────────────────────────┘
```

Pluggable seams (each is an interface with one v1 implementation and a registry):
document parsing (`DocumentIngest`), browser control (`BrowserDriver`), widget
behaviour (`WidgetAdapter` + profile), fill fallback (`FallbackAgent`), LLM
(`LLMProvider`), run log (`RunLogSink`), viewer renderer (`CitationRenderer`).

## Repo layout

| Path                         | What it is                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`         | JSON Schemas (source of truth) + generated TS types + codegen → service models                                   |
| `packages/core`              | Pure TS: session state machine, config loader/validator, planner, citation resolver, option matcher, event types |
| `packages/driver-playwright` | `BrowserDriver` impl (connectOverCDP, ariaSnapshot, locators)                                                    |
| `packages/adapters`          | `WidgetAdapter` registry + built-in adapters + profile types                                                     |
| `packages/fill-engine`       | Planner-driven executor: retry, verify, fallback agent                                                           |
| `packages/ingest`            | `.msg`/PDF → merged PDF + manifest + LiteParse text items                                                        |
| `packages/panel`             | React side panel: upload, field list, viewer, inline edit                                                        |
| `packages/api-client`        | Typed service client + fake for tests/dev                                                                        |
| `apps/desktop`               | Electron host: main, preload, utility process, packaging                                                         |
| `apps/service`               | FastAPI: `/extract`, `/agent/step`, `/match-option`, `/runs`                                                     |
| `apps/fixture-form`          | Angular test form: tabs, reveal, slow searchSelect, AG Grid                                                      |
| `configs/forms/<formId>`     | Per-form extraction prompts + fill config (`pnpm validate-configs` checks them)                                  |
| `evals/`                     | Extraction accuracy harness + committed synthetic golden set                                                     |

## Quick start

Node 22 + pnpm 9, Python 3.12 + uv.

```
pnpm install                 # also rebuilds the LiteParse native module for Electron
pnpm build && pnpm test && pnpm lint
uv run pytest                # Python service + eval harness tests
```

Try the whole loop without the service or gateway (fake LLM responses from fixtures):

```
pnpm e2e                     # fixture form + fake service + desktop, end to end
```

Piece by piece:

```
pnpm fixture:serve           # Angular fixture form on http://localhost:4300 (FIXTURE_PORT)
pnpm --filter desktop dev -- --dealId=1 --formId=fixtureDeal   # the app
uv run fib-service           # the real service on PORT 8787 (needs GATEWAY_* env)
uv run evals --forms configs/forms --golden evals/synthetic/cases --provider fake
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a form or a widget adapter, and each
package's README for its public API and test command.
