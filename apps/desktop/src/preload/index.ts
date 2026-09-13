import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  FieldEditPayload,
  FilesDroppedPayload,
  IpcPayloadMap,
  ViewerOpenPayload,
} from '@fib/contracts';

type Unsubscribe = () => void;

function onPush<K extends 'session:snapshot' | 'session:event'>(
  channel: K,
  listener: (payload: IpcPayloadMap[K]) => void,
): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, payload: IpcPayloadMap[K]): void =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** `window.fib` — the renderer's only way to reach the main process. */
export interface FibApi {
  onSessionSnapshot(listener: (payload: IpcPayloadMap['session:snapshot']) => void): Unsubscribe;
  onSessionEvent(listener: (payload: IpcPayloadMap['session:event']) => void): Unsubscribe;
  filesDropped(payload: FilesDroppedPayload): Promise<void>;
  fieldEdit(payload: FieldEditPayload): Promise<void>;
  viewerOpen(payload: ViewerOpenPayload): Promise<void>;
  getMergedPdf(): Promise<Uint8Array>;
  /** Electron 32+ removed File.path; resolves a dropped/picked File to its absolute path. */
  pathForFile(file: File): string;
}

const api: FibApi = {
  onSessionSnapshot: (listener) => onPush('session:snapshot', listener),
  onSessionEvent: (listener) => onPush('session:event', listener),
  filesDropped: (payload) => ipcRenderer.invoke('files:dropped', payload),
  fieldEdit: (payload) => ipcRenderer.invoke('field:edit', payload),
  viewerOpen: (payload) => ipcRenderer.invoke('viewer:open', payload),
  getMergedPdf: () => ipcRenderer.invoke('getMergedPdf'),
  // Electron 32+ removed File.path; this is the only renderer-safe way to a dropped file's path.
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('fib', api);
