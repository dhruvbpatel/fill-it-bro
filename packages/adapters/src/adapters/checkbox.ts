import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

const TRUE_VALUES = /^(true|yes|1)$/i;

export const checkboxAdapter: WidgetAdapter = {
  control: 'checkbox',

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string) {
    const wanted = TRUE_VALUES.test(value.trim());
    const current = (await ctx.driver.readValue(target)) === 'true';
    if (wanted !== current) await ctx.driver.click(target);
    return {};
  },

  async read(ctx: AdapterCtx, target: LocatorSpec): Promise<string | null> {
    return ctx.driver.readValue(target);
  },
};
