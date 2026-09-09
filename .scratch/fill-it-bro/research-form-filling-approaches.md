# Research: Form-Filling Engine Architecture — Playwright vs browser-use vs Raw DevTools

**Date:** 2026-09-08 · **Method:** 4 parallel research agents against primary sources (official docs, repos, issue trackers, release notes). All claims cited.

## The use case (fixed constraints)

- PDF → LLM → structured JSON extraction is **deterministic** (same schema, stable values every run).
- Target: third-party Angular forms we do **not** control. Unknown the **first** time; then **stable for months**.
- Same workflow repeated; only the PDF changes.
- Product goals: minimal user effort, **high accuracy, high speed**, desktop distribution (Electron).

Because extraction is deterministic and pages are stable, the filling problem is really: **map a page once, replay it deterministically forever, re-map only when it drifts.** Any engine that re-derives the page every run is paying LLM cost+latency+non-determinism to answer a question it already answered.

---

## PoC 1 — Playwright native (this repo)

Planner → executor → widget adapters → verify → LLM fallback agent; `getByRole`-first locators, aria snapshots, `connectOverCDP` into the Electron `WebContentsView`.

### Pros
1. **Accuracy guardrails built in.** Locators re-resolve against live DOM on every action (no stale handles); strict mode throws on ambiguous matches (mis-maps fail loudly instead of filling the wrong field); auto-wait/actionability checks (visible, stable-2-frames, hit-target, enabled, editable) prevent half-rendered Angular states from receiving input. [playwright.dev/docs/locators](https://playwright.dev/docs/locators), [/docs/actionability](https://playwright.dev/docs/actionability)
2. **The "map once → replay" pattern is vendor-endorsed, not a hack.** Playwright codegen generates exactly such a locator plan (prioritizing role/text/testid, refining for uniqueness); v1.56 shipped planner/generator/**healer** agents formalizing map → replay → re-heal; `locator.normalize()` + `page.pickLocator()` exist to produce clean plans programmatically. [playwright.dev/docs/codegen](https://playwright.dev/docs/codegen), [/docs/test-agents](https://playwright.dev/docs/test-agents), release notes v1.56–v1.63
3. **ariaSnapshot is purpose-built as the LLM's page encoding** (YAML since v1.49; `ariaSnapshotJSON()` with depth/boxes "useful for AI consumption" in v1.60/v1.63; bundled MCP server since v1.62 whose core pitch is "structured accessibility snapshots… deterministic tool application"). Ideal for first-run mapping and drift fingerprints. [playwright.dev/docs/aria-snapshots](https://playwright.dev/docs/aria-snapshots), [github.com/microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
4. **Speed & cost at steady state:** zero LLM calls per run after mapping; locator resolution + fill is tens-of-ms scale; no vision models, no screenshots.
5. **Determinism matches the product contract:** same plan + same values = same actions; failures are binary and diagnosable (strict violation = ambiguous mapping; timeout = page changed).

### Cons
1. **CDP fidelity tax:** our attach path (`connectOverCDP`) is officially "significantly lower fidelity than the Playwright protocol connection," Chromium-only, sensitive to launch args; no official attach-to-running-Electron API (`_electron` is launch-only, experimental). Biggest engineering risk in the current PoC is the **transport, not the pattern**. [connectOverCDP docs](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [/docs/api/class-electron](https://playwright.dev/docs/api/class-electron)
2. **First-run mapping is capped by the page's a11y quality.** Angular Material exposes good roles (verified in component source: mat-select/mat-autocomplete render `role=listbox/option` in CDK overlays), but div-buttons and non-semantic components force weaker locators. Also: mat-select/autocomplete/datepicker need multi-step overlay sequences, not one-shot `selectOption`/`fill` — the plan schema must support sequences. (angular/components source; [/docs/locators](https://playwright.dev/docs/locators))
3. **Drift detection is failure-driven unless we add it:** replay notices drift only on timeout/strict-violation. Need a stored aria-snapshot fingerprint per mapped page, diffed at run start (Playwright gives `toMatchAriaSnapshot` + `--update-snapshots` patch files for this).
4. **Strict mode cuts both ways:** duplicate labels ("Date" twice) hard-fail naive mapped locators; plans need filter/compound locators, making the LLM mapping task slightly harder.

---

## PoC 2 — browser-use (LLM-in-the-loop agent)

### Pros
1. Zero locator authoring for new pages — agent discovers elements from serialized DOM + element indices.
2. Drift-resilient by design; RecoveryEngine auto-recovers overlays/stale indices (PR #5307).
3. Structured output first-class (`output_model_schema`); MIT license; huge ecosystem (113k+ stars).

### Cons (all fatal for the steady-state run)
1. **Pays LLM cost+latency to re-derive a known page, every run.** One LLM call per step (up to 3 actions/call); serialized DOM re-sent each step; their own issue #5499: "may query the LLM again even when the required information is already available… increasing latency and cost, and potentially producing different results." Cloud pricing anchors ≥$0.006/step + tokens. ([AGENTS.md](https://github.com/browser-use/browser-use/blob/main/AGENTS.md), [#5499](https://github.com/browser-use/browser-use/issues/5499), [pricing](https://browser-use.com/pricing.md))
2. **Non-determinism is structural, not incidental:** wrong-element clicks from stale selector maps when the page mutates mid-step (#4518), duplicate index collisions → "model action could target the wrong element" (fixed only 0.13.7, #5291), silent click downgrades in iframes (#5152). Each is a misfill risk on a product whose contract is accuracy. (issue tracker, fetched 2026-09-08)
3. **The OSS lib has no replay/workflow mode** — `initial_actions` is only a no-LLM prefix. Full replay exists **only as a Cloud feature** ("Rerunnable scripts": teach once → save code → replay → repair if site changed — and even then "every later run still starts a model"). Browser-use's own product answer to "same task repeated" is *learn once, replay code, LLM only for repair* — i.e., the architecture of PoC 1, sold back to us. ([docs.cloud scripts](https://docs.browser-use.com/cloud/agent/scripts))
4. **Distribution cost:** Python ≥3.11 sidecar + pinned deps + Rust binary (0.13.0 "Rebuilt in Rust [beta]"), exclusive-control Chromium management that aborts if Chrome is open (#3398), telemetry to disable. Inside an app that already ships Chromium, this is dead weight.
5. **Velocity = churn:** Rust beta rewrite, CLI 3.0, retired "Skills," legacy Actor/Sandbox, V2/V3/V4 cloud APIs within a year — an embedded dependency that moves under a shipped EXE. ([releases](https://github.com/browser-use/browser-use/releases))

**Verdict:** right tool for the *first-run mapping/re-mapping* job; wrong engine for the per-run steady state. Don't embed it; borrow its conclusion.

---

## PoC 3 — Raw DevTools/CDP (direct injection)

`Runtime.evaluate` / `executeJavaScript` fill script; trusted events via `Input.*` when needed.

### Pros
1. **Fastest transport, zero new deps:** in-process call from Electron main → renderer; one host→page hop per fill vs N protocol round-trips per Playwright action (locate, wait-stable ×2 frames, hit-check, act, verify). Same fill script is portable to a Chrome extension later (`chrome.scripting` MAIN world — same "run function, await promise" shape).
2. Full discovery control: `DOMSnapshot.captureSnapshot` (flattened tree incl. shadow DOM/iframes, rects, input values) is an excellent LLM-labeling dump. ([DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/#method-captureSnapshot))
3. Electron gives everything needed: `executeJavaScript(InIsolatedWorld)`, `sendInputEvent` (trusted), `insertText`, `contents.debugger` (full CDP without external Chrome), preload/`contextBridge` IPC. ([webContents docs](https://www.electronjs.org/docs/latest/api/web-contents))

### Cons
1. **You re-implement Playwright's engine**: accessible-name computation, auto-wait/re-resolution after Angular re-renders, strictness, shadow-DOM piercing, hit-target checks — each a real correctness surface (table in agent findings; [/docs/actionability](https://playwright.dev/docs/actionability)).
2. **Synthetic events are `isTrusted:false`** — fine for most Angular forms (zone.js patches addEventListener so dispatched `input` events do trigger CD), but a defensive page can reject them; then you're hand-rolling coordinate math, key-event sequencing (`keyDown→char→keyUp`), and stateful `nodeId` bookkeeping (`documentUpdated` invalidates ids). Puppeteer exists precisely to paper over this. ([MDN isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted), [Puppeteer FAQ](https://pptr.dev/faq), [DOM domain](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#event-documentUpdated))
3. **Angular zoneless (v21+ default) trap:** reactive-forms model writes (`setValue/patchValue`) "do not automatically schedule component change detection" — any fill strategy bypassing DOM events risks stale UI. ([angular.dev/guide/zoneless](https://angular.dev/guide/zoneless#reactive-forms-in-zoneless-applications))
4. **No honest speed data exists** in primary sources for CDP-vs-Playwright latency; the structural advantage (fewer round-trips) is real but marginal next to LLM/network time. Not worth re-implementing actionability for.

**Verdict:** not a competing architecture — it's the fallback layer inside PoC 1 (trusted events for hostile widgets), kept via `contents.debugger`.

---

## What industry actually does (beyond our three PoCs)

The converged pattern for "unknown first time, stable afterward" is everywhere the same:

> **Record once → persist a deterministic artifact keyed by page identity → replay deterministically → exception/pre-flight-triggered healing → re-persist.**

Precedents:
- **Stagehand (Browserbase)** — the direct commercial precedent: caches `act()/observe()/extract()` results; cache key = **instruction + page content (a11y tree) + URL**; cached act() replays deterministically with self-healing off; **miss → LLM fallback → re-prime cache**. Documented hygiene: pin viewport/UA, block analytics/A-B scripts (they pollute the key), anchor instructions to visible labels, route dynamic values through `%variables%`. ([docs.stagehand.dev/v4/best-practices/caching](https://docs.stagehand.dev/v4/best-practices/caching))
- **Skyvern** — ships exactly three action modes: selector, prompt, and **selector-first with AI fallback** ("tries selector first, falls back to AI if it fails"); workflows persist as reusable DAGs. ([github.com/Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern))
- **Healenium** — the self-healing locator model: on `NoSuchElement`, score current DOM against the stored locator path, take the best candidate, **write the healed locator back**, flag for human review. ([healenium.io](https://healenium.io/docs/how_healenium_works))
- **Playwright itself** — planner (markdown spec) → generator (deterministic tests) → healer (repair on drift); MCP `--codegen` records deterministic code while an LLM acts. ([/docs/test-agents](https://playwright.dev/docs/test-agents), [playwright-mcp](https://github.com/microsoft/playwright-mcp))
- **Selenium IDE / RPA suites** — the artifact (`.side` project / workflow) is the durable asset; replay is deterministic.
- **Nobody ships agent-every-run** for stable workflows. Even Anthropic and OpenAI steer web work away from vision/pixel grounding toward DOM/page-level tools; vision is only for DOM-less surfaces (RDP, canvas, legacy apps). ([computer-use docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/computer-use-tool), [OpenAI CUA guide](https://platform.openai.com/docs/guides/tools-computer-use))

---

## Recommendation

**Build on PoC 1 (Playwright-native, this repo). It is already the architecture the industry converged on — it's missing only the automation of its own mapping layer.**

The repo's `configs/forms/<formId>` fill configs are *hand-authored* cached mappings; the planner/executor/adapters/verify/fallback loop is the replay engine; the `/agent/step` fallback agent is the healer. Delta to reach the Stagehand/Healenium-grade pattern:

1. **LLM-generated first mapping.** New form → capture `ariaSnapshotJSON()` → LLM emits a `getByRole`-first locator plan (with filter/compound locators and multi-step overlay sequences for Angular Material) → validate live → persist under `configs/forms/<formId>`. Replaces hand-authoring; one LLM pass per new page, never per run.
2. **Pre-flight drift fingerprint.** Store a partial-match aria snapshot of the form region with the plan; diff at run start. Drift → trigger re-map *before* filling, not at submit. ([aria-snapshots](https://playwright.dev/docs/aria-snapshots), `--update-snapshots` patch flow)
3. **Heal-on-miss with write-back.** On locator miss: re-derive candidates from the stored target description (role + accessible name — not raw XPath), score against current DOM (Healenium-style), pick best, write back to the plan, flag for human review in the panel.
4. **Hygiene for plan stability** (Stagehand's documented list): pin viewport/UA, block analytics/A-B scripts on the form page, keep field values out of the mapping (values are per-PDF variables).
5. **Keep a trusted-event fallback** for hostile widgets via `contents.debugger` `Input.*` — already available in-process; no new dependency.
6. **De-risk the transport.** `connectOverCDP` is documented as lower fidelity; evaluate driving the form page from a Playwright-launched context (form in a Playwright Chromium window, PDF/panel stay in Electron) or track the newer high-fidelity attach APIs (`browser.bind()`, v1.59+). This is the single biggest accuracy risk, not the fill logic.
7. **Extraction side is already right:** schema-constrained structured output; note Anthropic citations are incompatible with strict structured outputs (400) — two-pass (cite→extract) if per-field provenance needs upgrading.

**Not recommended:** embedding browser-use in the shipped product (cost/latency per run, structural non-determinism, no OSS replay mode, distribution cost, churn) — its own Cloud product validates map-once/replay instead. Raw-CDP as a *primary* engine (re-implementing actionability) is effort without an accuracy win; keep it as the fallback layer.

### Sources (primary)
- Playwright: locators, actionability, aria-snapshots, codegen, test-agents, frames, release notes v1.49–v1.63, `connectOverCDP`, `_electron` — playwright.dev
- browser-use: AGENTS.md, docs.browser-use.com (scripts, costs, telemetry, real-browser), releases 0.12.9–0.13.10, issues #4518/#5137/#5499/#3398, PRs #5291/#5152/#5307, pricing.md
- CDP/Electron: chromedevtools.github.io/devtools-protocol (DOM, DOMSnapshot, Input, Runtime), electronjs.org webContents/session/WebContentsView docs, developer.chrome.com chrome.scripting/sidePanel, Chromium admin docs, MDN isTrusted, pptr.dev FAQ, angular.dev zoneless guide, angular/components source
- Industry: docs.stagehand.dev caching, github.com/Skyvern-AI/skyvern, healenium.io, microsoft/playwright-mcp, selenium.dev, docs.claude.com computer-use & citations, platform.openai.com structured-outputs & CUA guide, microsoft/OmniParser
