# @fib/ingest

Local document ingestion for the Electron host: turns dropped files into a `DocumentSet`
(text items with bounding boxes + page manifest) that powers citations. Runs in an Electron
utility process; no document bytes ever leave the client.

## T03 scope: single PDF → DocumentSet

- `ingest(files, deps)` — exactly one `.pdf`; anything else throws `UnsupportedInput`.
  Produces `{ setId, sources: [{ sourceId: 'upload-1', kind: 'upload', name, mime }],
manifest (identity for a single upload), pages, mergedPdf }`. `IngestDocumentSet`
  extends the contract `DocumentSet` with `mergedPdf: Uint8Array`, which is client-only
  and never serialised across the service boundary.
- `parsePdf(bytes)` — LiteParse (OCR enabled) → `pages[].items` with ids `p{page}i{index}`
  (1-based page, 0-based item index in reading order), boxes in PDF points, top-left origin.
- `findPhrase(set, phrase)` — `{ mergedPage, itemIds }[]` matches after whitespace/case
  normalisation, within one item or stitched across consecutive items on the same page.

## T04 scope: .msg → merged PDF + manifest

- `ingest(files, deps)` now also accepts exactly one `.msg`. `IngestDeps` gains
  `htmlToPdf: HtmlToPdf`; `defaultDeps` wires it to `PlaywrightHtmlToPdf` (a hidden
  Chromium `page.pdf()`), which is what the Electron host will override with its own
  `webContents.printToPDF`-backed implementation in T21.
- `parseMsg(bytes)` (`src/msg.ts`) reads a `.msg` via `@kenjiuno/msgreader` into
  `{ bodyHtml, bodyText, attachments: { name, mime, bytes }[] }`. Mime is taken from
  `PR_ATTACH_MIME_TAG_W` when present, else guessed from the file extension.
- The body is rendered to a one-page PDF (`bodyHtml`, or `bodyText` wrapped in `<pre>`
  when there's no HTML body), then merged with attachments in order via
  `mergeSources()` (`src/merge.ts`, `pdf-lib` `copyPages`): source ids are `body`,
  `att-1`, `att-2`, … in attachment order. PDF attachments are copied as-is; PNG/JPG
  attachments become a single-page PDF sized to the image (`src/imageToPdf.ts`);
  anything else is skipped and recorded in the optional `DocumentSet.skipped[]`
  (`{ name, mime, reason }`, added to the `document-set` schema in this ticket).
- The merged PDF is run back through T03's `parsePdf`, so `.msg` and `.pdf` inputs
  produce the same `DocumentSet` shape.
- Everything stays in memory (`Uint8Array` in, `Uint8Array` out) — `ingest()` never
  writes its own temp files for a `.msg` input.

## Fixture: a hand-assembled `.msg` (no pure-JS `.msg` writer was needed)

`@tutao/oxmsg` turned out to be a pure-JS Outlook `.msg` **writer** (devDependency,
used only by the fixture script, never by runtime code), so `fixtures/sample.msg` is
generated rather than hand-built byte-for-byte: `pnpm --filter @fib/ingest fixtures`
regenerates it via `scripts/make-msg-fixture.ts`, which builds
- body text "Please onboard Goldman Sachs Incorporated",
- a 2-page PDF attachment `terms.pdf` (page 2: "Settlement 2026-09-30"), and
- a PNG attachment `fee.png` with the phrase "Fee 12,500" rendered as pixels — built
  by drawing the text into a throwaway one-page PDF with `pdf-lib` and rasterizing it
  with LiteParse's own `screenshot()` renderer (the same trick `scripts/bench.ts`
  already uses for the OCR fixture), so it's a genuine OCR case, not a text layer,

then writes them with `@tutao/oxmsg`'s `Email`/`Attachment` API and `.msg()`.

One interop wrinkle worth flagging for future `@kenjiuno/msgreader` users in this
repo: this package builds as real ESM (`module: ESNext`), and under Node's ESM/CJS
interop a default import of a CJS package like `msgreader` binds to the whole
`module.exports` object, not `module.exports.default` (that unwrapping is a
TypeScript-to-CommonJS emit behaviour, which never runs here). `src/msg.ts` unwraps
`.default` explicitly instead of relying on it.

## Parser build decision: native, not WASM

Measured with `pnpm --filter @fib/ingest bench` (generates `fixtures/scanned-10p.pdf` on
demand: 10 pages of full-page rendered-text images, i.e. OCR-required) on
Apple silicon (M-series), LiteParse 2.14.3, Node 24:

| build                             | OCR                                | warm-up | runs (ms)     | median | items found |
| --------------------------------- | ---------------------------------- | ------- | ------------- | ------ | ----------- |
| native `@llamaindex/liteparse`    | enabled (built-in Tesseract `eng`) | 669 ms  | 577, 596, 584 | 584 ms | 51          |
| wasm `@llamaindex/liteparse-wasm` | unavailable in this build          | 28 ms   | 1, 1, 1       | 1 ms   | 0           |

**Decision: the native build (`@llamaindex/liteparse`) is the runtime dependency.**

Reasons:

1. The WASM build ships no OCR engine (browser target; it requires a JS-side
   `ocrEngine` such as tesseract.js or an HTTP OCR server). On the scanned fixture it
   returns zero text items, while our inputs (scanned PDFs, `.msg` image attachments)
   are exactly the OCR-required case (PLAN §6 step 4).
2. Native OCR throughput is fine for interactive use: ~58 ms/page on the 10-page
   scanned fixture (first use also downloads/caches `eng.traineddata` once).
3. The remaining native-build risk is Electron packaging (rebuild against Electron's
   ABI in T28 — PLAN §14 risk 1), which is a deployment concern, not a correctness one.

`@llamaindex/liteparse-wasm` stays as a devDependency only, used by the benchmark.

## Fixtures

- `fixtures/simple.pdf` — committed; regenerate with `pnpm --filter @fib/ingest fixtures`.
  Page 1: "Issuer: Goldman Sachs Incorporated", page 2: "Amount: 1,250,000 USD".
- `fixtures/sample.msg` — committed; regenerate with `pnpm --filter @fib/ingest fixtures`
  (see "Fixture: a hand-assembled `.msg`" above).
- `fixtures/scanned-10p.pdf` — not committed; generated on demand by the bench script
  via pdf-lib + LiteParse page screenshots (image-only pages).
