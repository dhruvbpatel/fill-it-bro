import { registry } from './adapter.js';
import { buttonAdapter } from './adapters/button.js';
import { checkboxAdapter } from './adapters/checkbox.js';
import { dateAdapter, normaliseDate } from './adapters/date.js';
import { selectAdapter } from './adapters/select.js';
import { tabAdapter } from './adapters/tab.js';
import { textAdapter } from './adapters/text.js';
import { searchSelectAdapter } from './searchSelect.js';

registry.set('text', textAdapter);
registry.set('select', selectAdapter);
registry.set('searchSelect', searchSelectAdapter);
registry.set('checkbox', checkboxAdapter);
registry.set('date', dateAdapter);
registry.set('button', buttonAdapter);
registry.set('tab', tabAdapter);

export { registry } from './adapter.js';
export type { AdapterCtx, WidgetAdapter, WidgetProfile, MatchOptionResult } from './adapter.js';
export { valuesEqual } from './equality.js';
export { normaliseDate };
export { buttonAdapter } from './adapters/button.js';
export { checkboxAdapter } from './adapters/checkbox.js';
export { dateAdapter } from './adapters/date.js';
export { selectAdapter } from './adapters/select.js';
export { tabAdapter } from './adapters/tab.js';
export { textAdapter } from './adapters/text.js';
export { searchSelectAdapter } from './searchSelect.js';
export { NoMatchingOption, OptionsNotSettled, ProfileRequired } from './searchSelect.js';
