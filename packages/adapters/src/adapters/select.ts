import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

async function optionTexts(ctx: AdapterCtx, target: LocatorSpec): Promise<string[]> {
  const count = await ctx.driver.count({ css: 'option', within: target });
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    texts.push((await ctx.driver.readText({ css: 'option', within: target, nth: i })).trim());
  }
  return texts;
}

export const selectAdapter: WidgetAdapter = {
  control: 'select',

  async options(ctx: AdapterCtx, target: LocatorSpec): Promise<string[]> {
    return optionTexts(ctx, target);
  },

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string) {
    const options = await optionTexts(ctx, target);
    const match = await ctx.matchOption(value, options);
    if (match.index === null) {
      throw new Error(
        `select: no option matches "${value}" (options: ${options.length ? options.join(', ') : '(none)'})`,
      );
    }
    const label = options[match.index];
    await ctx.driver.selectByLabel(target, label);
    ctx.log(`select: "${value}" -> "${label}" via ${match.via} (confidence ${match.confidence})`);
    return { via: match.via };
  },

  async read(ctx: AdapterCtx, target: LocatorSpec): Promise<string | null> {
    const selected = { css: 'option:checked', within: target };
    if ((await ctx.driver.count(selected)) === 0) return null;
    return (await ctx.driver.readText(selected)).trim();
  },
};
