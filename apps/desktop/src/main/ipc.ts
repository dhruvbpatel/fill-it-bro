import { ipcMain } from 'electron';
import type { FieldEditPayload, FilesDroppedPayload, ViewerOpenPayload } from '@fib/contracts';

/**
 * Registers handlers for the renderer -> main invoke channels. No session
 * controller exists yet (T25); these are stubs so the typed bridge is wired
 * end to end.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('files:dropped', async (_event, _payload: FilesDroppedPayload) => {});
  ipcMain.handle('field:edit', async (_event, _payload: FieldEditPayload) => {});
  ipcMain.handle('viewer:open', async (_event, _payload: ViewerOpenPayload) => {});
}
