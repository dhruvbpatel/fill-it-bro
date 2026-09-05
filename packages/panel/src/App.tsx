import { useEffect, useMemo, useState } from 'react';
import type { SessionState, SessionSnapshot } from '@fib/core';
import { createDefaultPanelApi, type PanelApi } from './api/PanelApi.js';
import { DropZone } from './components/DropZone.js';
import { ProgressBar } from './components/ProgressBar.js';
import { FieldList } from './components/FieldList.js';

const IN_PROGRESS: readonly SessionState[] = ['ingesting', 'extracting', 'resolving', 'filling'];

// Matches @fib/core's initialSnapshot; re-declared locally so the renderer
// bundle never pulls in @fib/core's node-only config loader at runtime.
const INITIAL_SNAPSHOT: SessionSnapshot = { state: 'idle', fields: [], fillEvents: [] };

interface AppProps {
  /** Defaults to the Electron bridge when present, MemoryPanelApi otherwise (browser dev). */
  api?: PanelApi;
}

export function App({ api }: AppProps) {
  const panelApi = useMemo(() => api ?? createDefaultPanelApi(), [api]);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => panelApi.onSnapshot(setSnapshot), [panelApi]);

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
      {snapshot.fields.length > 0 && (
        <FieldList
          fields={snapshot.fields}
          events={snapshot.fillEvents}
          documentSet={snapshot.documentSet}
          onOpenCitation={(fieldId, citationIndex) =>
            void panelApi.openCitation(fieldId, citationIndex)
          }
        />
      )}
      {snapshot.state === 'failed' && <p role="alert">{snapshot.error ?? 'Session failed'}</p>}
    </main>
  );
}
