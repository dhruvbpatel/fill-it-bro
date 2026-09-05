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
- `fixtures/scanned-10p.pdf` — not committed; generated on demand by the bench script
  via pdf-lib + LiteParse page screenshots (image-only pages).
