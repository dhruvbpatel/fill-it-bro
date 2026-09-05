# 03: Ingest: PDF → DocumentSet

**What to build:** Dropping a single PDF produces a `DocumentSet` with every text item's text and bounding box, stable item ids, and a phrase finder that returns the page and item ids for a quote. This is the foundation of citations.

**Blocked by:** 02 (Contracts + codegen)

**Status:** done

## Read first
- PLAN.md §4 DocumentSet, §6 steps 4–5, §14 risk 1. LiteParse docs: https://developers.llamaindex.ai/liteparse/ (Node package, `textItems` with `x,y,width,height` in PDF points, top-left origin).

## Do exactly this
- `packages/ingest/src/ingest.ts`: `export async function ingest(files: string[], deps: IngestDeps): Promise<DocumentSet>`. For this ticket only `.pdf` is handled; other extensions throw `UnsupportedInput`.
- `packages/ingest/src/parse.ts`: `parsePdf(bytes: Uint8Array): Promise<Page[]>` using LiteParse with OCR enabled. Map each text item to `{ id: \`p${page}i${index}\`, text, x, y, w, h }` (1-based page, 0-based index in reading order). Page `width/height` in points.
- `sources = [{ sourceId: 'upload-1', kind: 'upload', name: basename, mime: 'application/pdf' }]`; `manifest[i] = { mergedPage: i+1, sourceId: 'upload-1', sourcePage: i+1 }`.
- `DocumentSet` in memory also carries `mergedPdf: Uint8Array` (TS type extends the contract type; never serialised).
- `packages/ingest/src/findPhrase.ts`: `findPhrase(set, phrase): { mergedPage: number; itemIds: string[] }[]` — normalise whitespace/case, match within a single item or across consecutive items on the same page (stitch by joining with a space).
- Benchmark script `packages/ingest/scripts/bench.ts` comparing LiteParse native vs WASM on `fixtures/scanned-10p.pdf` (generate the fixture with `pdf-lib` + rendered text images if none is provided). Record the decision and numbers in `packages/ingest/README.md` and set the chosen build as the dependency.
- Fixtures: `packages/ingest/fixtures/simple.pdf` (generate with `pdf-lib`: page 1 "Issuer: Goldman Sachs Incorporated", page 2 "Amount: 1,250,000 USD").

## Acceptance criteria
- [x] `ingest(['fixtures/simple.pdf'])` returns 2 pages; every item has `w>0 && h>0`.
- [x] `findPhrase(set, 'Goldman Sachs Incorporated')` returns page 1 with non-empty `itemIds`.
- [x] `findPhrase(set, '1,250,000 USD')` returns page 2.
- [x] README states native vs WASM choice with measured timings.
