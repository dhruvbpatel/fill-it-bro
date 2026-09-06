# @fib/panel

The React side panel (Vite-built, rendered in an Electron `WebContentsView`):
drop files, watch progress, review the field list, inspect citations in the PDF
viewer, edit values inline.

## Public API

- `App` — the panel root. Renders the drop zone, progress, field list, and (when a
  citation is opened) the `PdfViewer`. Defaults to the Electron bridge; pass an
  `api` for tests/browser dev.
- `PanelApi` and implementations (`src/api/PanelApi.ts`) — the typed bridge the panel
  talks to: `ElectronPanelApi` (`window.fib` contextBridge API), `MemoryPanelApi`
  (in-memory, for tests), `createDefaultPanelApi` (picks one).
- `deriveStatus`, `eventsForField`, `sortFields` — `FillEvent`s + extraction status →
  badge status (`verified | filledByAgent | needsReview | lowConfidence | notFound |
failed`) and the attention-first ordering.
- `citationSourceLabel`, `sourceDisplayName` — "from <name>, page N" labels.
- `PdfViewer` (`src/viewer/`) — `pdfjs-dist` page canvas + highlight overlay boxes
  scaled from PDF points, page navigation, document switcher derived from the manifest.
- Test fixtures: `fixtureDocumentSet`, `fixtureFields`, `fixtureFillEvents`,
  `fixtureSnapshot`.

The renderer never imports Node-only modules; `@fib/core` state types are re-declared
locally where the import would drag the config loader into the bundle.

## How to test

```
pnpm --filter @fib/panel test
```

Vitest + Testing Library component tests (jsdom).
