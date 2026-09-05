# 04: Ingest: .msg → merged PDF + manifest

**What to build:** Dropping an Outlook `.msg` produces one merged PDF (email body first, then each attachment in order, images as their own pages), a manifest mapping every merged page to its source, and text items via ticket 03's parser.

**Blocked by:** 03 (Ingest: PDF → DocumentSet)

**Status:** done

## Read first
- PLAN.md §6 steps 1–3, §4 DocumentSet manifest.

## Do exactly this
- `packages/ingest/src/msg.ts`: parse with `@kenjiuno/msgreader`; output `{ bodyHtml: string | null, bodyText: string, attachments: { name, mime, bytes }[] }`. If `bodyHtml` is null wrap `bodyText` in `<pre>`.
- `packages/ingest/src/htmlToPdf.ts`: `export interface HtmlToPdf { render(html: string): Promise<Uint8Array> }`. Provide `PlaywrightHtmlToPdf` (playwright chromium `page.setContent` + `page.pdf({ format: 'A4' })`) used by tests; the Electron implementation comes in ticket 21 and is injected via `IngestDeps.htmlToPdf`.
- `packages/ingest/src/imageToPdf.ts`: PNG/JPG → single-page PDF sized to the image via `pdf-lib`.
- `packages/ingest/src/merge.ts`: `mergeSources(parts: { source: DocumentSource; pdf: Uint8Array }[]): { mergedPdf: Uint8Array; manifest: ManifestEntry[]; sources: DocumentSource[] }` using `pdf-lib` `copyPages`. Source ids: `body`, `att-1`, `att-2`, … Attachment kinds: PDF → as-is; PNG/JPG → imageToPdf; anything else → skipped and listed in `set.skipped[]` (add this optional field to the `document-set` schema in this ticket, then rerun `pnpm contracts:gen`).
- Extend `ingest()` from ticket 03: `.msg` → split → render body → merge → `parsePdf(merged)`.
- Fixture generation script `packages/ingest/scripts/make-msg-fixture.ts` producing `fixtures/sample.msg` with body text "Please onboard Goldman Sachs Incorporated", a 2-page PDF attachment (page 2 contains "Settlement 2026-09-30"), and a PNG containing rendered text "Fee 12,500". If a pure-JS .msg writer is unavailable, commit a hand-built fixture and document how it was produced.

## Acceptance criteria
- [x] `sample.msg` → merged PDF with 4 pages; manifest = body/1, att-1/1, att-1/2, att-2/1.
- [x] `findPhrase(set, 'Settlement 2026-09-30')` returns mergedPage 3.
- [x] `findPhrase(set, 'Fee 12,500')` returns mergedPage 4 (OCR path).
- [x] No files remain in the OS temp directory after `ingest()` resolves.
