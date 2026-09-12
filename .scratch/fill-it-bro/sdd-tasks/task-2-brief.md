# Task 2: drop-anytime rerun (re-upload without restarting)

## Problem
The panel DropZone renders only in session states formReady|failed
(packages/panel/src/App.tsx line ~76), and the reducer accepts filesDropped only
from formReady (packages/core/src/session.ts). After a run reaches review, the
only way to process another document is restarting the app.

## Requirements (user chose "drop-anytime")
1. Reducer (packages/core/src/session.ts): accept filesDropped from review, done,
   and failed in addition to formReady. The transition resets the session to
   ingesting with document-level state cleared:
   - state: 'ingesting'
   - documentSet: undefined
   - extraction: undefined
   - fields: []
   - fillEvents: []
   - error: undefined
   Keep dealId/formId. Keep IllegalTransition for all other illegal states.
2. SessionController (apps/desktop/src/main/SessionController.ts): in onFilesDropped,
   clear this.mergedPdf (set null) before ingest so getMergedPdf cannot serve the
   previous run's PDF to the viewer.
3. Panel (packages/panel/src/App.tsx): DropZone visible in review, done, and
   failed as well (i.e. whenever NOT in an active in-flight state: not
   ingesting/extracting/resolving/filling). A second DropZone must never render
   simultaneously with the ProgressBar. Keep disabled-when-failed? NO — failed now
   allows re-drop; DropZone must be enabled in failed. Do not render the drop zone
   inside the viewer-pane view.
4. Panel test in packages/panel/src/App.test.tsx: snapshot in review with fields
   renders the drop zone; emitting filesDropped transition result (ingesting)
   swaps to ProgressBar. Update any existing tests that assumed drop zone absent
   in those states ONLY if their assertions conflict; preserve intent.
5. Desktop e2e (apps/desktop/tests/session.spec.ts or e2e/full-loop.spec.ts —
   pick the cheaper place that already drops via IPC): after reaching review,
   invoke fib.filesDropped a second time with the same fixture, and assert the
   session passes ingesting -> extracting ... -> review again (poll snapshots
   via fib.onSessionSnapshot like existing helpers).
6. TDD: failing tests first (RED) for reducer + panel + e2e assertion, then
   implement (GREEN). Record commands + outputs.

## Verify
- pnpm --filter @fib/core test
- pnpm --filter @fib/panel test
- cd apps/desktop && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/playwright test
  (also pnpm --filter desktop exec vitest run for controller unit tests)
