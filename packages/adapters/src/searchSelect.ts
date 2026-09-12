import type { AdapterCtx, WidgetAdapter, WidgetProfile } from './adapter.js';
import type { LocatorSpec } from '@fib/core';

export class ProfileRequired extends Error {
  constructor() {
    super(
      'searchSelect: a widget profile is required (trigger, searchInput, loadingIndicator, optionList, optionItem, selectedValue, settleMs, maxWaitMs)',
    );
    this.name = 'ProfileRequired';
  }
}

export class NoMatchingOption extends Error {
  constructor(value: string, options: string[]) {
    super(
      `searchSelect: no option matches "${value}" (options: ${
        options.length ? options.join(', ') : '(none)'
      })`,
    );
    this.name = 'NoMatchingOption';
  }
}

export class OptionsNotSettled extends Error {
  constructor(maxMs: number) {
    super(`searchSelect: option list did not settle within ${maxMs} ms`);
    this.name = 'OptionsNotSettled';
  }
}

interface ResolvedProfile {
  trigger: LocatorSpec;
  searchInput: LocatorSpec;
  loadingIndicator: LocatorSpec;
  optionList: LocatorSpec;
  optionItem: LocatorSpec;
  selectedValue: LocatorSpec;
  settleMs: number;
  maxWaitMs: number;
}

/**
 * All profile locators resolve `within` the field's target, so one form can host
 * several searchSelects and each profile stays widget-shape-only.
 */
function resolveProfile(profile: WidgetProfile, target: LocatorSpec): ResolvedProfile {
  const withinTarget = (spec: LocatorSpec | undefined, key: string): LocatorSpec => {
    if (!spec) throw new Error(`searchSelect: profile is missing "${key}"`);
    return { ...spec, within: target };
  };
  return {
    trigger: withinTarget(profile.trigger, 'trigger'),
    searchInput: withinTarget(profile.searchInput, 'searchInput'),
    loadingIndicator: withinTarget(profile.loadingIndicator, 'loadingIndicator'),
    optionList: withinTarget(profile.optionList, 'optionList'),
    optionItem: withinTarget(profile.optionItem, 'optionItem'),
    selectedValue: withinTarget(profile.selectedValue, 'selectedValue'),
    settleMs: requireNumber(profile.settleMs, 'settleMs'),
    maxWaitMs: requireNumber(profile.maxWaitMs, 'maxWaitMs'),
  };
}

function requireNumber(value: number | undefined, key: string): number {
  if (typeof value !== 'number') throw new Error(`searchSelect: profile is missing "${key}"`);
  return value;
}

async function collectOptions(ctx: AdapterCtx, profile: ResolvedProfile): Promise<string[]> {
  const count = await ctx.driver.count(profile.optionItem);
  const options: string[] = [];
  for (let i = 0; i < count; i++) {
    options.push((await ctx.driver.readText({ ...profile.optionItem, nth: i })).trim());
  }
  return options;
}

// The widget has no Escape handler; it only closes by picking an option or by
// clicking the trigger again (togglePanel). The fixture form wraps fields in a
// <label>, so the option-click is forwarded to the trigger and the panel pops
// right back open after a pick — then overlays the next field and blocks its
// clicks. So after picking (or when bailing out early), re-click the trigger to
// toggle the panel shut. Best-effort everywhere: a close failure is logged and
// swallowed so it can never mask the pick result or the original error.
async function closePanelBestEffort(ctx: AdapterCtx, p: ResolvedProfile): Promise<void> {
  try {
    if ((await ctx.driver.count(p.optionList)) === 0) return;
    await ctx.driver.click(p.trigger);
  } catch (err) {
    ctx.log(`searchSelect: panel close attempt failed (${(err as Error).message})`);
  }
}

export const searchSelectAdapter: WidgetAdapter = {
  control: 'searchSelect',

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string, profile?: WidgetProfile) {
    if (!profile) throw new ProfileRequired();
    const p = resolveProfile(profile, target);

    await ctx.driver.click(p.trigger);
    await ctx.driver.type(p.searchInput, value, { clear: true });
    try {
      await ctx.driver.waitFor(p.loadingIndicator, 'hidden', p.maxWaitMs);
    } catch (err) {
      // Ignore: either the indicator never appeared (options were already loaded) or
      // loading outlasted maxWaitMs; waitStable below enforces the same deadline.
      ctx.log(
        `searchSelect: loading indicator not hidden after ${p.maxWaitMs} ms (${(err as Error).message}); relying on waitStable`,
      );
    }
    try {
      await ctx.driver.waitStable(p.optionList, p.settleMs, p.maxWaitMs);
    } catch (err) {
      await closePanelBestEffort(ctx, p);
      if (err instanceof Error && err.name === 'StableTimeout')
        throw new OptionsNotSettled(p.maxWaitMs);
      throw err;
    }

    const options = await collectOptions(ctx, p);
    const match = await ctx.matchOption(value, options);
    if (match.index === null) {
      await closePanelBestEffort(ctx, p);
      throw new NoMatchingOption(value, options);
    }

    await ctx.driver.click({ ...p.optionItem, nth: match.index });
    await ctx.driver.waitFor(p.selectedValue, 'visible', 2000);
    await closePanelBestEffort(ctx, p);
    ctx.log(`searchSelect: "${value}" -> "${options[match.index]}" via ${match.via}`);
    return { via: match.via };
  },

  async read(
    ctx: AdapterCtx,
    target: LocatorSpec,
    profile?: WidgetProfile,
  ): Promise<string | null> {
    if (!profile) throw new ProfileRequired();
    const p = resolveProfile(profile, target);
    if ((await ctx.driver.count(p.selectedValue)) === 0) return null;
    const text = (await ctx.driver.readText(p.selectedValue)).trim();
    return text === '' ? null : text;
  },
};
