# Research: running Fill-It-Bro inside a Chrome tab

Date: 2026-09-11. Method: Tavily pro research plus official Chrome / Playwright / Puppeteer docs. Builds on [browser-tab feasibility](./research-browser-tab-form-filling.md) (2026-09-10) and does **not** re-open the Playwright vs Browser Use vs DevTools MCP engine choice.

Status: researched. No POC, no enterprise policy test, no widget-fidelity benchmark on the internal forms.

## Conclusion

Yes: the product can live in the user's Chrome (or Edge) tab. No: you cannot drop a filling engine and hope a web page fills a cross-origin loan form by itself. Playwright as a **Node library** does not run inside a tab. Playwright as a **locator / actionability / ariaSnapshot model** can, through an extension that talks CDP via `chrome.debugger`.

The Electron + Playwright bottleneck is mostly the **host**, not the fill loop. Extraction, planning, widget adapters, verification, and the React review panel can stay. What Electron uniquely costs you is a second Chromium, a second login profile, and an EXE. What Playwright uniquely costs you is a Node runtime — and that cost only exists if the driver stays in Node.

Do not introduce a per-field agent. Keep the existing planner → adapter → verify loop. LLM stays on `/extract` and `/match-option`, with `/agent/step` only as fallback.

## What “inside a Chrome tab” actually means

Three different products get collapsed into that phrase:

1. **A normal webpage** that takes `?dealId=` and shows a right-hand panel. It can load the deal UI if it *is* the loan app. It cannot inspect or type into a **different origin** iframe (same-origin policy, CSP `frame-ancestors`). A Fillet Pro launcher page wrapping the loan app in an iframe is a dead end unless you change the loan app. [Same-origin](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

2. **A Chrome extension** that opens the loan URL as a top-level tab (existing SSO cookies) and hosts the upload/review UI in Chrome's Side Panel. This is the only browser-native way to sit beside a third-party form you do not modify. [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

3. **A local process** (Node sidecar or native messaging host) that attaches to the user's already-running Chrome over CDP. Filling still happens *to* a Chrome tab; orchestration still lives *outside* the tab. [Playwright MCP connecting to browsers](https://playwright.dev/mcp/configuration/browser-extension).

(1) is not viable for an unchanged loan app. Choose between (2) and (3), or combine them.

## How Playwright plays in this

| Runtime | Can it drive the user's existing Chrome tab? | Notes |
| --- | --- | --- |
| `playwright` / `playwright-core` in Node | Yes, via `connectOverCDP` or a CDP endpoint | This is today's driver, pointed at Electron. Pointing it at Chrome requires remote debugging on that Chrome. [connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). |
| Official Playwright as an extension | No first-party product | [Issue #23514](https://github.com/microsoft/playwright/issues/23514) is P3 “collecting feedback”. |
| [playwright-crx](https://github.com/ruifigueira/playwright-crx) | Yes | Community Playwright flavor that implements `ConnectionTransport` on `chrome.debugger`. Usable as a library from an MV3 service worker. Chrome Web Store recorder exists; Chrome version lag is a real issue (open tickets on Chrome 143+). |
| Playwright MCP `--extension` | Yes, but wrong shape | Official extension reuses the logged-in session for **MCP tools**. Still a Node MCP server. Built for agent steps, not a deterministic `BrowserDriver`. [Docs](https://playwright.dev/mcp/configuration/browser-extension). |
| Puppeteer `ExtensionTransport.connectTab(tabId)` | Yes | Official, **experimental**. Bundled `puppeteer-core` browser build. One page per connection; new tabs via `chrome.tabs` then a new connect. [Guide](https://pptr.dev/guides/running-puppeteer-in-extensions). |

What to preserve from Playwright is the **contract**, not the Electron attach path: locators that re-resolve, actionability, strictness, `ariaSnapshot` with refs, `neverClick`. That contract is `@fib/core`'s `BrowserDriver`. Today's `PlaywrightDriver` is one implementation.

## Options (ranked for this repo)

### A. Chrome extension host + debugger-backed driver (recommended product shape)

Side panel = `@fib/panel`. Loan form = normal tab. Fill engine runs in the extension (side-panel document, not the MV3 service worker). Driver is either playwright-crx or Puppeteer `ExtensionTransport`.

- SSO: user's profile. No second Chromium.
- Trusted input: CDP `Input` domain is available to `chrome.debugger`. [Restricted domains include Input, DOM, Accessibility, Runtime](https://developer.chrome.com/docs/extensions/reference/api/debugger).
- Deterministic: same fill-engine, no per-field LLM.
- Costs: `debugger` permission, yellow infobar (suppressed for force-installed enterprise extensions), enterprise host/DLP policies can block `attach()`, DevTools on that tab detaches the session, MV3 worker can die (keep run state in the panel).
- Puppeteer vs playwright-crx: Puppeteer is vendor-documented and experimental; playwright-crx keeps locator/`expect` closer to what the fill-engine already assumes. Treat both as POC arms against the fixture form's searchSelect and AG Grid.

### B. Chrome extension UI + native messaging to the existing Node fill-engine

Smallest rewrite of `@fib/fill-engine`. Extension owns tabs, panel, file drop. A registered native host runs ingest + Playwright-or-CDP filling. Native messaging max message 1 MB from host / 64 MiB to host. [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

- Still a local install (host manifest + binary), but far smaller than an Electron Chromium.
- Best if LiteParse OCR or HTML→PDF must stay native.
- Filling can still target the user's tab if the host talks back through the extension's debugger, or if Chrome is started with a debug endpoint (worse UX).

### C. Content-script / `chrome.scripting` executor (no debugger)

Port adapters to MAIN-world DOM writes. No infobar, easier store/enterprise story.

- `dispatchEvent` is `isTrusted: false`. Angular often still updates via Zone.js; zoneless / defensive widgets / AG Grid editors may not. [Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted).
- You re-implement a slice of Playwright actionability. Acceptable **if** the fixture + internal widgets pass a bake-off against A.

### D. Node sidecar attached to user Chrome (keep PlaywrightDriver)

Launch Chrome with `--remote-debugging-port` or enable `chrome://inspect/#remote-debugging`, then `connectOverCDP`. Playwright MCP documents channel attach (`--cdp-endpoint=chrome`) and extension-bridge attach.

- Smallest code change. Removes Electron Chromium. Keeps Node, keeps Playwright, keeps isolated-debug UX issues (infobar, users must not close the debug session).
- Does **not** give you a Side Panel. You still need an extension or a separate window for upload/review.
- Remote-debugging a user's default profile is a security/ops smell; a dedicated debug profile loses SSO, which is the whole point.

### E. Stay on the Electron EXE

Valid while the POC is proving extraction + adapters. Do not spend effort “optimizing Playwright” inside Electron: the fill is already the cheap part. The EXE cost is Chromium + packaging + SSO isolation.

Dropping Playwright but keeping Electron (`webContents.executeJavaScript` / `webContents.debugger`) removes a library and keeps the bottleneck.

### F. Cooperative page APIs later (WebMCP, postMessage bridge)

Only if the loan app team will expose tools or a fill bridge. Not available for an unchanged third-party form. [Angular WebMCP](https://angular.dev/ai/webmcp) is experimental and requires page participation.

## Side panel + `?dealId=` journey

Documented constraints, not product promises:

1. User opens an allowlisted launcher URL with a deal id, **or** is already on the loan form.
2. Extension constructs the loan URL from an allowlisted template and opens/focuses that tab.
3. Side panel opens only from a **user gesture** (`sidePanel.open()`). A URL load after SSO cannot silently open it. Toolbar icon, keyboard shortcut, or a button in a content script / extension page can. [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
4. Dock left/right is a Chrome setting, not yours.
5. Bind the run to `tabId` + deal id + document URL. Do not let a plan from tab A fill tab B.
6. Webpage → extension messaging needs `externally_connectable` for the launcher origin.

## What the Electron + Playwright “bottleneck” actually is

Separate the costs. Only some vanish with a Chrome tab.

| Cost | Electron + Playwright today | Ext + debugger driver | Ext + native host | Sidecar + PlaywrightDriver |
| --- | --- | --- | --- | --- |
| Ship a Chromium | Yes | No | No | No |
| Isolated SSO profile | Yes | No | No | No (if attached to that profile) |
| Node / Playwright runtime | Yes | No | Yes | Yes |
| EXE / code signing | Yes | Extension | Extension + host | Sidecar |
| `connectOverCDP` fidelity tax | Yes (self-attach) | N/A (chrome.debugger) | Optional | Yes |
| Native ingest (LiteParse, HTML→PDF) | Yes | Must replace | Keep | Keep |
| Trusted input | Yes | Yes | Yes | Yes |
| Debugger infobar / enterprise attach policy | No (own window) | Yes | If host uses debugger | Yes |

Ingest is the sleeper constraint. `@fib/ingest` uses LiteParse (native OCR), `@kenjiuno/msgreader` (JS), pdf-lib (JS), and HTML→PDF via Playwright or Electron `printToPDF`. In a pure extension: PDFs can go through pdf.js (already in the panel) with weaker OCR; `.msg` can parse in JS; HTML→PDF and native OCR likely need WASM or a native host. Do not assume “extension” automatically means “zero local binary” if Outlook OCR quality is a requirement.

## Scaling: multiple documents, multiple tabs

Keep the session model you already have (`dealId`, `formId`, one fill session). Key it by **`tabId`**.

- `chrome.debugger` is documented to attach to **one or more tabs**; events are routed by `tabId`. [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).
- Puppeteer's extension transport is **one page per connection**. Parallel deals = N `connectTab` connections, not one Browser object creating pages. [Puppeteer guide](https://pptr.dev/guides/running-puppeteer-in-extensions).
- Playwright-crx's original design attached per tab for the same reason.
- Only one debugger client per target: user-opened DevTools detaches you (`canceled_by_user`).
- MV3 service workers are not a process-per-tab runtime. Run the executor in the **side panel document** (or one panel per window) so a worker idle-kill cannot lose in-flight fills. Active debugger sessions can extend worker lifetime; that is not durable storage.
- Extraction scales on the Python service (N documents → N `/extract` calls). Filling scales as N independent `BrowserDriver` instances. Do not share locators/refs across tabs.
- Product policy still matters: previous research settled **one active deal at a time** for v1. Parallel tabs are an architecture property, not a v1 UX requirement. Build `tabId` isolation now so N tabs later is a scheduler, not a rewrite.

Generic pattern:

```
for each (tabId, dealId):
  bind driver to that tab only
  ingest docs for that session (local)
  extract (service, parallelizable)
  plan + execute + verify (deterministic, in-process)
  review in the panel keyed to tabId
  never submit
```

## Recommended migration for this codebase

The PLAN already named the seam: `BrowserDriver` v1 = Playwright over CDP; future = “Chrome extension host”.

1. Freeze Electron as the **accuracy baseline**, not the distribution end-state.
2. Keep `@fib/core`, `@fib/fill-engine`, `@fib/adapters`, `@fib/panel`, `@fib/api-client` as-is.
3. Add `apps/extension` (MV3, WXT or equivalent): Side Panel shells `@fib/panel`; content script is a thin mailbox; launcher URL allowlist.
4. Add `packages/driver-extension` implementing `BrowserDriver`. POC A: playwright-crx or Puppeteer `connectTab`. POC C: content-script fallback. Same executor, two drivers, fixture form bake-off.
5. Move ingest last. If LiteParse quality is required, native messaging for ingest only; filling can still be in-extension.
6. Do not productize Playwright MCP, Browser Use, or Page Agent for the steady-state fill. They are mapping/debug tools.

POC gate (same as Sep 10, still unmeasured): zero silent misfills on the fixture corpus versus the Electron Playwright driver; searchSelect + AG Grid must commit the same values; interruption (tab close, DevTools open, user typing) stops and re-observes.

## What not to do

- Iframe the loan app inside Fillet Pro.
- Call an LLM per field.
- Replace `BrowserDriver` with Playwright MCP tool calls.
- Assume a webpage can `import 'playwright'` and fill another tab.
- Assume debugger will be allowed on managed machines without testing `ExtensionSettings` / DLP / `DisableScreenshots` attach failures.
- Copy Nanobrowser wholesale (it patches `navigator.webdriver`, persists agent history, and sends page content to an LLM). Architecture reference only.

## Sources

- [Puppeteer: running in Chrome extensions](https://pptr.dev/guides/running-puppeteer-in-extensions)
- [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Playwright MCP: connect via extension / CDP](https://playwright.dev/mcp/configuration/browser-extension)
- [playwright-crx](https://github.com/ruifigueira/playwright-crx)
- [Playwright as a Chromium extension (#23514)](https://github.com/microsoft/playwright/issues/23514)
- [CDP Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input)
- [Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- Prior internal notes: [form-filling approaches](./research-form-filling-approaches.md), [browser-tab feasibility](./research-browser-tab-form-filling.md)
