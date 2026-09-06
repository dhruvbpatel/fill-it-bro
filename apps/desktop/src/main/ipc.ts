import { ipcMain } from 'electron';
import type { SessionController } from './SessionController.js';

/**
 * Registers handlers for the renderer -> main invoke channels, delegating to
 * the session controller (ticket 25). `viewer:open` and `getMergedPdf` are
 * served from the controller's current merged PDF.
 */
export function registerIpcHandlers(controller: SessionController): void {
  ipcMain.handle('files:dropped', (_event, payload: { paths: string[] }) => {
    controller.filesDropped(payload.paths);
  });
  ipcMain.handle('field:edit', (_event, payload: { fieldId: string; value: string }) => {
    controller.editField(payload.fieldId, payload.value);
  });
  ipcMain.handle('viewer:open', (_event, payload: { fieldId: string }) => {
    controller.viewerOpen(payload.fieldId);
  });
  ipcMain.handle('getMergedPdf', () => controller.getMergedPdf());
}
