import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

export const buttonAdapter: WidgetAdapter = {
  control: 'button',

  async write(ctx: AdapterCtx, target: LocatorSpec) {
    await ctx.driver.click(target);
    return {};
  },

  async read(): Promise<string | null> {
    return null;
  },
};
