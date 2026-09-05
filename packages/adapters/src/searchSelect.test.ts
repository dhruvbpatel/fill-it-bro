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

  async connect(): Promise<void> {
    throw new Error('not implemented');
  }
  async click(t: LocatorSpec | Ref): Promise<void> {
    this.calls.push(`click ${specKey(t)}`);
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

  it('maps driver StableTimeout to OptionsNotSettled and closes the panel with Escape', async () => {
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
      'press issuerName>.fib-select__search Escape',
    ]);
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

  it('presses Escape and throws NoMatchingOption when matchOption returns null', async () => {
    const driver = new FakeDriver();
    driver.optionTexts = [];
    const ctx = makeCtx(driver, async () => ({ index: null, via: 'llm', confidence: 0 }));

    await expect(
      searchSelectAdapter.write(ctx, TARGET, 'Nonexistent Bank', PROFILE),
    ).rejects.toThrow(NoMatchingOption);

    expect(driver.calls[driver.calls.length - 1]).toBe(
      'press issuerName>.fib-select__search Escape',
    );
    expect(driver.calls).not.toContain('click issuerName>.fib-select__option[0]');
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
});
