import type {
  DocumentSet,
  ExtractionResult,
  FillEvent,
  ResolvedField,
} from './generated/schemas.js';

/**
 * Desktop preload bridge channel names (PLAN §9). `session:*` are pushed
 * main -> renderer via `webContents.send`; the rest are invoked
 * renderer -> main via `ipcRenderer.invoke`.
 */
export const ipcChannels = [
  'session:snapshot',
  'session:event',
  'files:dropped',
  'field:edit',
  'viewer:open',
] as const;

export type IpcChannel = (typeof ipcChannels)[number];

/** Pushed main -> renderer whenever the fill session's state changes. */
export interface SessionSnapshotPayload {
  state: string;
  dealId?: string;
  formId?: string;
  documentSet?: DocumentSet;
  extraction?: ExtractionResult;
  fields: ResolvedField[];
  fillEvents: FillEvent[];
  error?: string;
}

/** Pushed main -> renderer for each session/fill event as it happens. */
export type SessionEventPayload =
  | { type: 'formReady' }
  | { type: 'ingested'; documentSet: DocumentSet }
  | { type: 'extracted'; result: ExtractionResult }
  | { type: 'resolved'; fields: ResolvedField[] }
  | { type: 'fillEvent'; event: FillEvent }
  | { type: 'fillComplete' }
  | { type: 'fail'; reason: string };

/** Invoked renderer -> main when files are dropped on the panel's drop zone. */
export interface FilesDroppedPayload {
  paths: string[];
}

/** Invoked renderer -> main when the user edits a field's value inline. */
export interface FieldEditPayload {
  fieldId: string;
  value: string;
}

/** Invoked renderer -> main to jump the document viewer to a field's citation. */
export interface ViewerOpenPayload {
  fieldId: string;
}

export interface IpcPayloadMap {
  'session:snapshot': SessionSnapshotPayload;
  'session:event': SessionEventPayload;
  'files:dropped': FilesDroppedPayload;
  'field:edit': FieldEditPayload;
  'viewer:open': ViewerOpenPayload;
}
