import { describe, expect, it } from 'vitest';
import type { AdapterCtx, MatchOptionResult, WidgetProfile } from './adapter.js';
import {
  NoMatchingOption,
  OptionsNotSettled,
  ProfileRequired,
  searchSelectAdapter,
} from './searchSelect.js';
import type { BrowserDriver, LocatorSpec, Ref } from '@fib/core';

const PROFILE: WidgetProfile = {
  trigger: { css: '.fib-select__trigger' },
  searchInput: { css: '.fib-select__search' },
  loadingIndicator: { css: '.fib-select__loading' },
  optionList: { css: '.fib-select__options' },
  optionItem: { css: '.fib-select__option' },
  selectedValue: { css: '.fib-select__value' },
  settleMs: 300,
  maxWaitMs: 5000,
};

const TARGET: LocatorSpec = { formControlName: 'issuerName' };

function specKey(t: LocatorSpec | Ref): string {
  if ('ref' in t) return `ref=${t.ref}`;
  const scope = t.within ? `${specKey(t.within)}>` : '';
  const which =
    t.css ?? t.formControlName ?? t.label ?? (t.role ? `${t.role.role}:${t.role.name}` : '?');
  return `${scope}${which}${t.nth !== undefined ? `[${t.nth}]` : ''}`;
}

class FakeDriver implements BrowserDriver {
  calls: string[] = [];
  optionTexts: string[] = [];
  selectedValue: string | null = '';
  failWaitStableWith: Error | null = null;
  // Models the dropdown panel: it only opens/closes via the trigger (togglePanel);
  // option clicks close it, but the form's wrapping <label> forwards that click to
  // the trigger, which re-opens the panel (labelForwarding).
  panelOpen = false;
  labelForwarding = false;

  async connect(): Promise<void> {
    throw new Error('not implemented');
  }
  async click(t: LocatorSpec | Ref): Promise<void> {
    const d = specKey(t);
    if (d.endsWith('.fib-select__trigger')) this.panelOpen = !this.panelOpen;
    else if (d.includes('.fib-select__option') && !this.labelForwarding) this.panelOpen = false;
    this.calls.push(`click ${d}`);
  }
  async type(t: LocatorSpec | Ref, text: string, opts?: { clear?: boolean }): Promise<void> {
    this.calls.push(`type ${specKey(t)} "${text}" clear=${String(opts?.clear === true)}`);
  }
  async fill(): Promise<void> {
    throw new Error('not implemented');
  }
  async selectByLabel(): Promise<void> {
    throw new Error('not implemented');
  }
  async press(t: LocatorSpec | Ref, key: string): Promise<void> {
    this.calls.push(`press ${specKey(t)} ${key}`);
  }
  async readValue(): Promise<string | null> {
    throw new Error('not implemented');
  }
  async readText(t: LocatorSpec | Ref): Promise<string> {
    const d = specKey(t);
    if (d.includes('.fib-select__option')) {
      const nth = 'nth' in t && t.nth !== undefined ? t.nth : 0;
      return this.optionTexts[nth] ?? '';
    }
    if (d.includes('.fib-select__value')) return this.selectedValue ?? '';
    throw new Error(`readText: unexpected target ${d}`);
  }
  async count(t: LocatorSpec): Promise<number> {
    const d = specKey(t);
    // NB: '__options' must be tested before '__option' ('options' contains 'option').
    if (d.includes('.fib-select__options')) return this.panelOpen ? 1 : 0;
    if (d.includes('.fib-select__option')) return this.optionTexts.length;
    if (d.includes('.fib-select__value')) return this.selectedValue === null ? 0 : 1;
    throw new Error(`count: unexpected target ${d}`);
  }
  async waitFor(t: LocatorSpec | Ref, state: 'visible' | 'hidden' | 'attached'): Promise<void> {
    this.calls.push(`waitFor ${specKey(t)} ${state}`);
  }
  async waitStable(t: LocatorSpec, settleMs: number, maxMs: number): Promise<void> {
    this.calls.push(`waitStable ${specKey(t)} ${settleMs} ${maxMs}`);
    if (this.failWaitStableWith) throw this.failWaitStableWith;
  }
  async ariaSnapshot(): Promise<{ yaml: string; refs: string[] }> {
    throw new Error('not implemented');
  }
  setNeverClick(): void {
    throw new Error('not implemented');
  }
}

function makeCtx(
  driver: FakeDriver,
  matchOption: (wanted: string, options: string[]) => Promise<MatchOptionResult>,
): AdapterCtx {
  return { driver, matchOption, log: () => {} };
}

describe('searchSelect adapter', () => {
  it('throws ProfileRequired when write is called without a profile', async () => {
    const driver = new FakeDriver();
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));
    await expect(searchSelectAdapter.write(ctx, TARGET, 'x')).rejects.toThrow(ProfileRequired);
    expect(driver.calls).toEqual([]);
  });

  it('throws ProfileRequired when read is called without a profile', async () => {
    const driver = new FakeDriver();
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));
    await expect(searchSelectAdapter.read(ctx, TARGET)).rejects.toThrow(ProfileRequired);
  });

  it('opens, types with clear, settles, clicks the matched option and returns via', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['Goldman Sachs Incorporated'];
    driver.selectedValue = 'Goldman Sachs Incorporated';
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));

    const result = await searchSelectAdapter.write(ctx, TARGET, 'Goldman Sachs', PROFILE);

    expect(result).toEqual({ via: 'exact' });
    expect(driver.calls).toEqual([
      'click issuerName>.fib-select__trigger',
      'type issuerName>.fib-select__search "Goldman Sachs" clear=true',
      'waitFor issuerName>.fib-select__loading hidden',
      'waitStable issuerName>.fib-select__options 300 5000',
      'click issuerName>.fib-select__option[0]',
      'waitFor issuerName>.fib-select__value visible',
    ]);
    expect(await searchSelectAdapter.read(ctx, TARGET, PROFILE)).toBe('Goldman Sachs Incorporated');
  });

  it('resolves profile locators within the target', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['A'];
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));
    const target: LocatorSpec = { css: 'app-fib-search-select' };

    await searchSelectAdapter.write(ctx, target, 'A', PROFILE);

    expect(driver.calls[0]).toBe('click app-fib-search-select>.fib-select__trigger');
    expect(driver.calls[3]).toBe('waitStable app-fib-search-select>.fib-select__options 300 5000');
    expect(driver.calls[4]).toBe('click app-fib-search-select>.fib-select__option[0]');
  });

  it('maps driver StableTimeout to OptionsNotSettled and closes the panel with a trigger click', async () => {
    const driver = new FakeDriver();
    const stableTimeout = new Error('waitStable: element did not settle within 500 ms');
    stableTimeout.name = 'StableTimeout';
    driver.failWaitStableWith = stableTimeout;
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));

    await expect(
      searchSelectAdapter.write(ctx, TARGET, 'Goldman Sachs', { ...PROFILE, maxWaitMs: 500 }),
    ).rejects.toThrow(OptionsNotSettled);

    expect(driver.calls).toEqual([
      'click issuerName>.fib-select__trigger',
      'type issuerName>.fib-select__search "Goldman Sachs" clear=true',
      'waitFor issuerName>.fib-select__loading hidden',
      'waitStable issuerName>.fib-select__options 300 500',
      'click issuerName>.fib-select__trigger',
    ]);
    expect(driver.panelOpen).toBe(false);
  });

  it('ignores errors from the loading-indicator wait and proceeds to waitStable', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['Morgan Stanley & Co'];
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));
    driver.waitFor = async (t: LocatorSpec | Ref, state: 'visible' | 'hidden' | 'attached') => {
      if (specKey(t).includes('.fib-select__loading') && state === 'hidden') {
        driver.calls.push(`waitFor ${specKey(t)} ${state} THREW`);
        throw new Error('Timeout 500ms exceeded');
      }
      driver.calls.push(`waitFor ${specKey(t)} ${state}`);
    };

    const result = await searchSelectAdapter.write(ctx, TARGET, 'Morgan Stanley & Co', PROFILE);

    expect(result).toEqual({ via: 'exact' });
    expect(driver.calls).toContain('waitFor issuerName>.fib-select__loading hidden THREW');
    expect(driver.calls).toContain('waitStable issuerName>.fib-select__options 300 5000');
  });

  it('clicks the trigger to close the panel and still throws NoMatchingOption', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = [];
    const ctx = makeCtx(driver, async () => ({ index: null, via: 'llm', confidence: 0 }));

    await expect(
      searchSelectAdapter.write(ctx, TARGET, 'Nonexistent Bank', PROFILE),
    ).rejects.toThrow(NoMatchingOption);

    expect(driver.calls[driver.calls.length - 1]).toBe('click issuerName>.fib-select__trigger');
    expect(driver.calls).not.toContain('click issuerName>.fib-select__option[0]');
    expect(driver.panelOpen).toBe(false);
  });

  it('read returns null when no value is selected or the element is absent', async () => {
    const driver = new FakeDriver();
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));
    expect(await searchSelectAdapter.read(ctx, TARGET, PROFILE)).toBeNull();

    driver.selectedValue = null;
    expect(await searchSelectAdapter.read(ctx, TARGET, PROFILE)).toBeNull();

    driver.selectedValue = '  JPMorgan Chase Bank  ';
    expect(await searchSelectAdapter.read(ctx, TARGET, PROFILE)).toBe('JPMorgan Chase Bank');
  });

  it('re-clicks the trigger after a successful pick when the label reopens the panel', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['Goldman Sachs Incorporated'];
    driver.selectedValue = 'Goldman Sachs Incorporated';
    driver.labelForwarding = true; // label forwards the option-click to the trigger
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));

    const result = await searchSelectAdapter.write(ctx, TARGET, 'Goldman Sachs', PROFILE);

    expect(result).toEqual({ via: 'exact' });
    expect(driver.calls).toEqual([
      'click issuerName>.fib-select__trigger',
      'type issuerName>.fib-select__search "Goldman Sachs" clear=true',
      'waitFor issuerName>.fib-select__loading hidden',
      'waitStable issuerName>.fib-select__options 300 5000',
      'click issuerName>.fib-select__option[0]',
      'waitFor issuerName>.fib-select__value visible',
      'click issuerName>.fib-select__trigger',
    ]);
    expect(driver.panelOpen).toBe(false);
  });

  it('resolves even when the post-pick panel close fails, logging instead of throwing', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['Goldman Sachs Incorporated'];
    driver.selectedValue = 'Goldman Sachs Incorporated';
    driver.labelForwarding = true;
    const origClick = driver.click.bind(driver);
    driver.click = async (t: LocatorSpec | Ref): Promise<void> => {
      if (driver.calls.length > 0 && specKey(t).includes('.fib-select__trigger')) {
        driver.calls.push(`click ${specKey(t)} THREW`);
        throw new Error('panel is not attached');
      }
      await origClick(t);
    };
    const logs: string[] = [];
    const ctx: AdapterCtx = {
      driver,
      matchOption: async () => ({ index: 0, via: 'exact', confidence: 1 }),
      log: (msg) => logs.push(msg),
    };

    const result = await searchSelectAdapter.write(ctx, TARGET, 'Goldman Sachs', PROFILE);

    expect(result).toEqual({ via: 'exact' });
    expect(driver.calls).toContain('click issuerName>.fib-select__trigger THREW');
    expect(logs.join('\n')).toContain('panel close attempt failed');
  });

  it('does not re-click the trigger after a successful pick when the panel already closed', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = ['Goldman Sachs Incorporated'];
    driver.selectedValue = 'Goldman Sachs Incorporated';
    // no label forwarding: the option click itself closes the panel
    const ctx = makeCtx(driver, async () => ({ index: 0, via: 'exact', confidence: 1 }));

    await searchSelectAdapter.write(ctx, TARGET, 'Goldman Sachs', PROFILE);

    expect(driver.calls).toEqual([
      'click issuerName>.fib-select__trigger',
      'type issuerName>.fib-select__search "Goldman Sachs" clear=true',
      'waitFor issuerName>.fib-select__loading hidden',
      'waitStable issuerName>.fib-select__options 300 5000',
      'click issuerName>.fib-select__option[0]',
      'waitFor issuerName>.fib-select__value visible',
    ]);
  });

  it('still throws NoMatchingOption when the trigger close attempt itself fails', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = [];
    const origClick = driver.click.bind(driver);
    driver.click = async (t: LocatorSpec | Ref): Promise<void> => {
      if (driver.calls.length > 0 && specKey(t).includes('.fib-select__trigger')) {
        driver.calls.push(`click ${specKey(t)} THREW`);
        throw new Error('panel is not attached');
      }
      await origClick(t);
    };
    const logs: string[] = [];
    const ctx: AdapterCtx = {
      driver,
      matchOption: async () => ({ index: null, via: 'llm', confidence: 0 }),
      log: (msg) => logs.push(msg),
    };

    await expect(
      searchSelectAdapter.write(ctx, TARGET, 'Nonexistent Bank', PROFILE),
    ).rejects.toThrow(NoMatchingOption);
    expect(driver.calls).toContain('click issuerName>.fib-select__trigger THREW');
    expect(logs.join('\n')).toContain('close attempt failed');
  });
});
