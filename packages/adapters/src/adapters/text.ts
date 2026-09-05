import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

export const textAdapter: WidgetAdapter = {
  control: 'text',

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string) {
    await ctx.driver.click(target);
    await ctx.driver.type(target, value, { clear: true });
    await ctx.driver.press(target, 'Tab');
    return {};
  },

  async read(ctx: AdapterCtx, target: LocatorSpec): Promise<string | null> {
    return ctx.driver.readValue(target);
  },
};
