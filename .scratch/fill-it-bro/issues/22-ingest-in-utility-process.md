# 22: Ingest in utility process

**What to build:** Parsing runs off the main thread in an Electron utility process, reporting progress, returning the DocumentSet and merged PDF bytes, and leaving no temp files behind.

**Blocked by:** 21 (Electron host shell), 04 (Ingest: .msg → merged PDF + manifest)

**Status:** ready-for-agent

## Do exactly this
- `apps/desktop/src/ingest-worker/index.ts`: entry for `utilityProcess.fork`. Messages in: `{ type: 'ingest', id, paths: string[] }`. Messages out: `{ type: 'progress', id, stage: 'split'|'renderBody'|'merge'|'parse', pct }`, `{ type: 'done', id, documentSet, mergedPdf: ArrayBuffer }` (transfer list), `{ type: 'error', id, message }`.
- HTML→PDF cannot run in the utility process; the worker sends `{ type: 'needHtmlToPdf', id, html }` and main replies `{ type: 'htmlToPdf', id, pdf: ArrayBuffer }` using `ElectronHtmlToPdf`. Implement `IngestDeps.htmlToPdf` in the worker as that round-trip.
- `apps/desktop/src/main/ingestService.ts`: `ingestFiles(paths, onProgress): Promise<{ documentSet, mergedPdf }>`; forks lazily, reuses the process, kills it on app quit.

## Acceptance criteria
- [ ] Integration test (electron test runner) ingests `packages/ingest/fixtures/sample.msg` through the worker and receives 4 pages with a correct manifest.
- [ ] Progress messages arrive for all four stages.
- [ ] Temp directory contains no `fib-*` files after completion.
