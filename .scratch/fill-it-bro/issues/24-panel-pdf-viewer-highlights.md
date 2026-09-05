# 24: Panel: PDF viewer with highlights

**What to build:** Clicking a field opens the merged PDF at the cited page with the exact text boxes highlighted and pulsing, and a document switcher derived from the manifest lets the user jump between the email body and attachments.

**Blocked by:** 12 (Core: citation resolver), 23 (Panel: upload + field list)

**Status:** done

## Do exactly this
- `packages/panel/src/viewer/PdfViewer.tsx` using `pdfjs-dist` (worker via Vite `?url`). Props: `pdf: Uint8Array`, `page: number`, `boxes: Box[]`, `manifest`, `sources`, `onPageChange`.
- Render one page at a time to a `<canvas>` at `scale = containerWidth / viewport(1).width`; overlay `<div class="hl">` per box with `left = x*scale`, `top = y*scale`, `width = w*scale`, `height = h*scale` (LiteParse boxes are already top-left origin in points; no y-flip). Pulse animation 1.2 s on mount, then persistent 30 % highlight.
- Toolbar: prev/next page, page `n / total`, document switcher `<select>` listing `sources` with page ranges from the manifest; choosing one jumps to its first merged page.
- `FieldRow` click → `openCitation(fieldId, 0)`; the panel routes to the viewer with that citation's `mergedPage` and `boxes`; multiple citations → small "1/2" cycler.
- Scroll so the first box is vertically centred.

## Acceptance criteria
- [x] Component test renders `packages/ingest/fixtures/simple.pdf` at a fixed 600 px width and asserts a highlight div's `left/top` within 1 px of `x*scale`,`y*scale` for a known item.
- [x] Switcher for a 4-page manifest (body/att-1/att-2) shows three entries with ranges 1, 2–3, 4.
- [x] Clicking a field with a page-3 citation changes the viewer page to 3.
