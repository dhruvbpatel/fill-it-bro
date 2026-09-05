import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

export const tabAdapter: WidgetAdapter = {
  control: 'tab',

  async write(ctx: AdapterCtx, target: LocatorSpec) {
    await ctx.driver.click(target);
    await ctx.driver.waitFor(target, 'visible', 2000);
    return {};
  },

  async read(): Promise<string | null> {
    return null;
  },
};
