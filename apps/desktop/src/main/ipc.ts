import { ipcMain } from 'electron';

/**
 * Registers handlers for the renderer -> main invoke channels. No session
 * controller exists yet (T25); these are stubs so the typed bridge is wired
 * end to end.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('files:dropped', async () => {});
  ipcMain.handle('field:edit', async () => {});
  ipcMain.handle('viewer:open', async () => {});
}
