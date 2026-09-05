import { describe, expect, it } from 'vitest';
import * as panel from './index';

describe('@fib/panel entry point', () => {
  it('exposes the panel public API', () => {
    expect(panel.App).toBeTypeOf('function');
    expect(panel.MemoryPanelApi).toBeTypeOf('function');
    expect(panel.ElectronPanelApi).toBeTypeOf('function');
    expect(panel.createDefaultPanelApi).toBeTypeOf('function');
    expect(panel.deriveStatus).toBeTypeOf('function');
    expect(panel.sortFields).toBeTypeOf('function');
    expect(panel.citationSourceLabel).toBeTypeOf('function');
    expect(panel.fixtureDocumentSet.setId).toBe('set-1');
  });
});
