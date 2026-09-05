// @fib/panel — side panel UI (ticket 23).
export type { PanelApi, MemoryPanelApiCalls, WindowFib } from './api/PanelApi.js';
export { ElectronPanelApi, MemoryPanelApi, createDefaultPanelApi } from './api/PanelApi.js';
export {
  deriveStatus,
  eventsForField,
  sortFields,
  type PanelFieldStatus,
} from './state/deriveStatus.js';
export { citationSourceLabel, sourceDisplayName } from './state/sourceLabel.js';
export { App } from './App.js';
export {
  fixtureDocumentSet,
  fixtureFields,
  fixtureFillEvents,
  fixtureSnapshot,
} from './fixtures.js';
