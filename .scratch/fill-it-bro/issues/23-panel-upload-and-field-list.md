# 23: Panel: upload + field list

**What to build:** The side panel a user sees: drop files, watch ingest and extraction progress, then a field list with a status badge per field sorted so items needing attention come first, each labelled with where its value came from.

**Blocked by:** 06 (TS api-client + fake), 02 (Contracts + codegen)

**Status:** ready-for-agent

## Read first
- PLAN.md §9.

## Do exactly this
- `packages/panel/src/api/PanelApi.ts`:
  ```ts
  export interface PanelApi {
    onSnapshot(cb: (s: SessionSnapshot) => void): () => void;
    dropFiles(paths: string[]): Promise<void>;
    editField(fieldId: string, value: string): Promise<void>;
    openCitation(fieldId: string, citationIndex: number): Promise<void>;
    getMergedPdf(): Promise<Uint8Array>;
  }
  ```
  `ElectronPanelApi` wraps `window.fib`; `MemoryPanelApi` for tests and Storybook-less dev (`pnpm --filter panel dev` uses it with fixture data).
- Components: `DropZone` (drag/drop + file picker, accepts `.pdf,.msg`), `ProgressBar` (states ingesting/extracting/resolving/filling with step counter from `fillEvents`), `FieldList`, `FieldRow` (label, value, badge, source label "from <source name>, page N"), `StatusBadge`.
- Status derivation `deriveStatus(field, events)`: `failed` if last event for field is `stepFailed`; `filledByAgent` if verified via `agent`; `needsReview` if via `fuzzy|llm` or `status === 'unverifiedCitation'`; `lowConfidence` if `confidence < 0.6`; `notFound` if `status === 'notFound'`; else `verified` if a `stepVerified` exists; else `pending`.
- Sort: `failed, notFound, needsReview, lowConfidence, filledByAgent, verified, pending`, stable within a group by config order.
- Grid groups render as a collapsible block with one row per cell.

## Acceptance criteria
- [ ] Testing Library tests for `deriveStatus` (all branches) and sort order.
- [ ] Dropping a file calls `dropFiles` with the path list.
- [ ] Source label renders "from sample.msg › attachment 1, page 2" for a manifest hit on att-1/2.
