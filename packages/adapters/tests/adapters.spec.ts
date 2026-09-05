import { expect, test } from '@playwright/test';
import { normalise } from '@fib/core';
import { PlaywrightDriver } from '../../driver-playwright/src/index.js';
import { registry, type AdapterCtx, type WidgetAdapter, type WidgetProfile } from '../src/index.js';
import { FIXTURE_PAGE_URL, launchChromiumOverCdp, type LaunchedChromium } from './cdp-launcher';

let launched: LaunchedChromium;
let driver: PlaywrightDriver;
let ctx: AdapterCtx;

// Test-local matcher: exact tier -> normalised tier (core's normalise) -> no match.
// The LLM/fuzzy tiers are not this ticket's scope (core option matcher is T13).
async function matchOption(
  wanted: string,
  options: string[],
): Promise<{ index: number | null; via: 'exact' | 'fuzzy' | 'llm'; confidence: number }> {
  const exact = options.indexOf(wanted);
  if (exact >= 0) return { index: exact, via: 'exact', confidence: 1 };
  const normalisedWanted = normalise(wanted);
  const index = options.findIndex((option) => normalise(option) === normalisedWanted);
  if (index >= 0) return { index, via: 'exact', confidence: 0.9 };
  return { index: null, via: 'exact', confidence: 0 };
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

function adapter(control: WidgetAdapter['control']): WidgetAdapter {
  const found = registry.get(control);
  if (!found) throw new Error(`adapter "${control}" not registered`);
  return found;
}

async function modelText(): Promise<string> {
  return driver.readText({ css: '#model' });
}

test('text adapter writes dealAmount and the model registers it', async () => {
  const text = adapter('text');
  await text.write(ctx, { formControlName: 'dealAmount' }, '1250000');
  expect(await text.read(ctx, { formControlName: 'dealAmount' })).toBe('1250000');
  await expect.poll(modelText).toContain('"dealAmount":"1250000"');
});

test('text adapter replaces a previous value (clears first)', async () => {
  const text = adapter('text');
  await text.write(ctx, { formControlName: 'dealAmount' }, '111');
  await text.write(ctx, { formControlName: 'dealAmount' }, '222');
  expect(await text.read(ctx, { formControlName: 'dealAmount' })).toBe('222');
  await expect.poll(modelText).toContain('"dealAmount":"222"');
});

test('select adapter lists options, matches "usd" via the normalised tier, reads back "USD"', async () => {
  const select = adapter('select');
  const currency = { formControlName: 'currency' };
  expect(await select.options?.(ctx, currency)).toEqual(['USD', 'EUR', 'GBP']);
  const result = await select.write(ctx, currency, 'usd');
  expect(result.via).toBe('exact');
  expect(await select.read(ctx, currency)).toBe('USD');
  await expect.poll(modelText).toContain('"currency":"USD"');
});

test('select adapter throws when no option matches', async () => {
  const select = adapter('select');
  await expect(select.write(ctx, { formControlName: 'currency' }, 'CHF')).rejects.toThrow(
    /no option matches "CHF"/,
  );
});

test('checkbox adapter checks on truthy values, unchecks on falsy, reads true/false', async () => {
  const checkbox = adapter('checkbox');
  const target = { formControlName: 'isConfidential' };
  await checkbox.write(ctx, target, 'yes');
  expect(await checkbox.read(ctx, target)).toBe('true');
  await expect.poll(modelText).toContain('"isConfidential":true');
  await checkbox.write(ctx, target, '0');
  expect(await checkbox.read(ctx, target)).toBe('false');
  await expect.poll(modelText).toContain('"isConfidential":false');
});

test('date adapter normalises DD/MM/YYYY per profile.dateFormat to 2026-09-30', async () => {
  const date = adapter('date');
  const target = { formControlName: 'settlementDate' };
  const profile: WidgetProfile = { dateFormat: 'DD/MM/YYYY' };
  await date.write(ctx, target, '30/09/2026', profile);
  expect(await date.read(ctx, target)).toBe('2026-09-30');
  await expect.poll(modelText).toContain('"settlementDate":"2026-09-30"');
});

test('date adapter accepts ISO and "D Month YYYY" without a profile', async () => {
  const date = adapter('date');
  const target = { formControlName: 'settlementDate' };
  await date.write(ctx, target, '15 October 2026');
  expect(await date.read(ctx, target)).toBe('2026-10-15');
  await expect.poll(modelText).toContain('"settlementDate":"2026-10-15"');
  await date.write(ctx, target, '2026-01-02');
  expect(await date.read(ctx, target)).toBe('2026-01-02');
  await expect.poll(modelText).toContain('"settlementDate":"2026-01-02"');
});

test('button adapter clicks (value ignored) and reveals the feeType select', async () => {
  const button = adapter('button');
  const addFees = { role: { role: 'button', name: 'Add fees' } };
  expect(await button.read(ctx, addFees)).toBeNull();
  await button.write(ctx, addFees, 'ignored');
  await driver.waitFor({ formControlName: 'feeType' }, 'visible', 5_000);
});

test('tab adapter switches tabs and reads null', async () => {
  const tab = adapter('tab');
  const parties = { role: { role: 'tab', name: 'Parties' } };
  const deal = { role: { role: 'tab', name: 'Deal' } };
  expect(await tab.read(ctx, parties)).toBeNull();
  await tab.write(ctx, parties, 'ignored');
  await driver.waitFor({ css: '[data-testid="parties-grid"]' }, 'visible', 10_000);
  await tab.write(ctx, deal, 'ignored');
  await driver.waitFor({ formControlName: 'dealAmount' }, 'visible', 10_000);
});
