import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionState, SessionSnapshot } from '@fib/core';
import { createDefaultPanelApi, type PanelApi } from './api/PanelApi.js';
import { DropZone } from './components/DropZone.js';
import { ProgressBar } from './components/ProgressBar.js';
import { FieldList } from './components/FieldList.js';
import { PdfViewer } from './viewer/PdfViewer.js';

const IN_PROGRESS: readonly SessionState[] = ['ingesting', 'extracting', 'resolving', 'filling'];

// Matches @fib/core's initialSnapshot; re-declared locally so the renderer
// bundle never pulls in @fib/core's node-only config loader at runtime.
const INITIAL_SNAPSHOT: SessionSnapshot = { state: 'idle', fields: [], fillEvents: [] };

interface AppProps {
  /** Defaults to the Electron bridge when present, MemoryPanelApi otherwise (browser dev). */
  api?: PanelApi;
}

/** Viewer routing state: which field/citation is open, plus free page navigation. */
interface ViewerCitation {
  fieldId: string;
  index: number;
}

export function App({ api }: AppProps) {
  const panelApi = useMemo(() => api ?? createDefaultPanelApi(), [api]);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => panelApi.onSnapshot(setSnapshot), [panelApi]);

  const [citation, setCitation] = useState<ViewerCitation | null>(null);
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [mergedPdf, setMergedPdf] = useState<Uint8Array | null>(null);

  const openCitation = useCallback(
    (fieldId: string, citationIndex: number) => {
      setCitation({ fieldId, index: citationIndex });
      setPageOverride(null);
      void panelApi.openCitation(fieldId, citationIndex);
    },
    [panelApi],
  );

  const viewerField = citation
    ? snapshot.fields.find((f) => f.fieldId === citation.fieldId)
    : undefined;
  const activeCitation = viewerField?.citations[citation?.index ?? 0];

  // A new document set invalidates the cached merged PDF.
  const setId = snapshot.documentSet?.setId;
  useEffect(() => setMergedPdf(null), [setId]);

  useEffect(() => {
    if (!activeCitation || mergedPdf) return;
    let cancelled = false;
    void panelApi.getMergedPdf().then((bytes) => {
      if (!cancelled) setMergedPdf(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [activeCitation, mergedPdf, panelApi]);

  const cycleCitation = () => {
    if (!citation || !viewerField) return;
    const next = (citation.index + 1) % viewerField.citations.length;
    setCitation({ fieldId: citation.fieldId, index: next });
    setPageOverride(null);
  };

  const showDropZone = snapshot.state === 'formReady' || snapshot.state === 'failed';
  return (
    <main className="panel">
      <h1>Fill-It-Bro panel</h1>
      {showDropZone && (
        <DropZone
          onDrop={(paths) => void panelApi.dropFiles(paths)}
          disabled={snapshot.state === 'failed'}
        />
      )}
      {IN_PROGRESS.includes(snapshot.state) && (
        <ProgressBar state={snapshot.state} fillEvents={snapshot.fillEvents} />
      )}
      {activeCitation && mergedPdf && snapshot.documentSet ? (
        <section className="viewer-pane" data-testid="viewer-pane">
          <div className="viewer-header">
            <button type="button" data-testid="viewer-close" onClick={() => setCitation(null)}>
              ‹ Fields
            </button>
            <span className="viewer-field">{citation?.fieldId}</span>
            {viewerField && viewerField.citations.length > 1 && (
              <button
                type="button"
                data-testid="citation-cycler"
                title="Next citation"
                onClick={cycleCitation}
              >
                {(citation?.index ?? 0) + 1}/{viewerField.citations.length}
              </button>
            )}
          </div>
          <PdfViewer
            pdf={mergedPdf}
            page={pageOverride ?? activeCitation.mergedPage}
            boxes={activeCitation.boxes}
            manifest={snapshot.documentSet.manifest}
            sources={snapshot.documentSet.sources}
            onPageChange={setPageOverride}
          />
        </section>
      ) : snapshot.fields.length > 0 ? (
        <FieldList
          fields={snapshot.fields}
          events={snapshot.fillEvents}
          documentSet={snapshot.documentSet}
          onOpenCitation={openCitation}
        />
      ) : null}
      {snapshot.state === 'failed' && <p role="alert">{snapshot.error ?? 'Session failed'}</p>}
    </main>
  );
}
