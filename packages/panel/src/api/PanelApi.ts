import type { SessionSnapshot } from '@fib/core';
import type { SessionSnapshotPayload } from '@fib/contracts';
import { fixtureMergedPdf, fixtureSnapshot } from '../fixtures.js';

/**
 * The panel's only view of the outside world (ticket 23). The real
 * implementation talks to the Electron main process via `window.fib`; tests
 * and `pnpm --filter panel dev` use {@link MemoryPanelApi}.
 */
export interface PanelApi {
  onSnapshot(cb: (s: SessionSnapshot) => void): () => void;
  dropFiles(paths: string[]): Promise<void>;
  editField(fieldId: string, value: string): Promise<void>;
  openCitation(fieldId: string, citationIndex: number): Promise<void>;
  getMergedPdf(): Promise<Uint8Array>;
}

/** Minimal structural view of the preload bridge (apps/desktop preload, T21). */
export interface WindowFib {
  onSessionSnapshot(listener: (payload: SessionSnapshotPayload) => void): () => void;
  filesDropped(payload: { paths: string[] }): Promise<void>;
  fieldEdit(payload: { fieldId: string; value: string }): Promise<void>;
  viewerOpen(payload: { fieldId: string }): Promise<void>;
  getMergedPdf?(): Promise<Uint8Array>;
}

declare global {
  interface Window {
    fib?: WindowFib;
  }
}

function requireWindowFib(): WindowFib {
  const fib = globalThis.window?.fib;
  if (!fib) {
    throw new Error('window.fib is not available — ElectronPanelApi requires the Electron preload');
  }
  return fib;
}

/** Real implementation: wraps the `window.fib` preload bridge. */
export class ElectronPanelApi implements PanelApi {
  private readonly fib: WindowFib;

  constructor(fib: WindowFib = requireWindowFib()) {
    this.fib = fib;
  }

  onSnapshot(cb: (s: SessionSnapshot) => void): () => void {
    return this.fib.onSessionSnapshot((payload) => cb(payload as SessionSnapshot));
  }

  async dropFiles(paths: string[]): Promise<void> {
    await this.fib.filesDropped({ paths });
  }

  async editField(fieldId: string, value: string): Promise<void> {
    await this.fib.fieldEdit({ fieldId, value });
  }

  async openCitation(fieldId: string, citationIndex: number): Promise<void> {
    // The ipc contract (`viewer:open`) carries only fieldId today; T24 routes
    // the citation index inside the viewer. The parameter stays in the
    // interface so the panel API does not change when that lands.
    void citationIndex;
    await this.fib.viewerOpen({ fieldId });
  }

  async getMergedPdf(): Promise<Uint8Array> {
    // The bridge exposes getMergedPdf once T25 wires the session controller;
    // until then behave gracefully with empty bytes.
    if (this.fib.getMergedPdf) {
      return this.fib.getMergedPdf();
    }
    return new Uint8Array();
  }
}

export interface MemoryPanelApiCalls {
  droppedFiles: string[][];
  edits: { fieldId: string; value: string }[];
  citations: { fieldId: string; citationIndex: number }[];
}

/** In-memory implementation for tests and browser dev (`pnpm --filter panel dev`). */
export class MemoryPanelApi implements PanelApi {
  readonly calls: MemoryPanelApiCalls = { droppedFiles: [], edits: [], citations: [] };
  private readonly listeners = new Set<(s: SessionSnapshot) => void>();

  constructor(
    private snapshot: SessionSnapshot = fixtureSnapshot(),
    private mergedPdf: Uint8Array = fixtureMergedPdf(),
  ) {}

  onSnapshot(cb: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async dropFiles(paths: string[]): Promise<void> {
    this.calls.droppedFiles.push(paths);
  }

  async editField(fieldId: string, value: string): Promise<void> {
    this.calls.edits.push({ fieldId, value });
  }

  async openCitation(fieldId: string, citationIndex: number): Promise<void> {
    this.calls.citations.push({ fieldId, citationIndex });
  }

  async getMergedPdf(): Promise<Uint8Array> {
    return this.mergedPdf;
  }

  /** Push a new snapshot to every subscriber (tests drive the panel with this). */
  emit(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

/** Electron renderer → ElectronPanelApi, plain browser/dev → MemoryPanelApi. */
export function createDefaultPanelApi(): PanelApi {
  return globalThis.window?.fib ? new ElectronPanelApi() : new MemoryPanelApi();
}
