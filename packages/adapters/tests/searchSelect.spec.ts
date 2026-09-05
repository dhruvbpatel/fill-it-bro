import { expect, test } from '@playwright/test';
import { matchOption as coreMatchOption } from '@fib/core';
import { PlaywrightDriver } from '../../driver-playwright/src/index.js';
import { registry, type AdapterCtx, type WidgetProfile } from '../src/index.js';
import { NoMatchingOption, OptionsNotSettled } from '../src/searchSelect.js';
import { FIXTURE_PAGE_URL, launchChromiumOverCdp, type LaunchedChromium } from './cdp-launcher';

// Profile mirrors configs/forms/fixtureDeal/widget-profiles.json "fixtureSearchSelect".
const PROFILE: WidgetProfile = {
  trigger: { css: '.fib-select__trigger' },
  searchInput: { css: '.fib-select__search' },
  optionList: { css: '.fib-select__options' },
  optionItem: { css: '.fib-select__option' },
  loadingIndicator: { css: '.fib-select__loading' },
  selectedValue: { css: '.fib-select__value' },
  settleMs: 300,
  maxWaitMs: 5000,
};

const TARGET = { formControlName: 'issuerName' };

let launched: LaunchedChromium;
let driver: PlaywrightDriver;
let ctx: AdapterCtx;

// Core option matcher plus a fake llm that always answers index 0 (this ticket's
// scope is the adapter; the service-backed matcher arrives with the fill engine).
async function matchOption(
  wanted: string,
  options: string[],
): Promise<{ index: number | null; via: 'exact' | 'fuzzy' | 'llm'; confidence: number }> {
  const result = await coreMatchOption(wanted, options, async () => ({
    index: 0,
    confidence: 0.9,
  }));
  return {
    index: result.index,
    via: result.via === 'none' ? 'llm' : result.via,
    confidence: result.confidence,
  };
}

function searchSelect() {
  const found = registry.get('searchSelect');
  if (!found) throw new Error('adapter "searchSelect" not registered');
  return found;
}

function modelText(): Promise<string> {
  return driver.readText({ css: '#model' });
}

test.beforeEach(async () => {
  launched = await launchChromiumOverCdp();
  driver = new PlaywrightDriver();
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.waitFor({ css: '#model' }, 'attached', 15_000);
  ctx = { driver, matchOption, log: (msg) => console.log(`[fib-adapters] ${msg}`) };
});

test.afterEach(async () => {
  await driver?.close();
  await launched?.stop();
});

test('"Goldman Sachs" resolves "Goldman Sachs Incorporated" via llm and the model updates', async () => {
  const result = await searchSelect().write(ctx, TARGET, 'Goldman Sachs', PROFILE);
  expect(result.via).toBe('llm');
  expect(await searchSelect().read(ctx, TARGET, PROFILE)).toBe('Goldman Sachs Incorporated');
  await expect.poll(modelText).toContain('"issuerName":"Goldman Sachs Incorporated"');
});

test('"Morgan Stanley & Co" matches exactly and the model updates', async () => {
  const result = await searchSelect().write(ctx, TARGET, 'Morgan Stanley & Co', PROFILE);
  expect(result.via).toBe('exact');
  expect(await searchSelect().read(ctx, TARGET, PROFILE)).toBe('Morgan Stanley & Co');
  await expect.poll(modelText).toContain('"issuerName":"Morgan Stanley & Co"');
});

test('maxWaitMs 500 rejects with OptionsNotSettled', async () => {
  await expect(
    searchSelect().write(ctx, TARGET, 'Goldman Sachs', { ...PROFILE, maxWaitMs: 500 }),
  ).rejects.toThrow(OptionsNotSettled);
});

test('"Nonexistent Bank" throws NoMatchingOption and leaves the model untouched', async () => {
  await expect(searchSelect().write(ctx, TARGET, 'Nonexistent Bank', PROFILE)).rejects.toThrow(
    NoMatchingOption,
  );
  expect(await searchSelect().read(ctx, TARGET, PROFILE)).toBeNull();
  await expect.poll(modelText).toContain('"issuerName":""');
});
