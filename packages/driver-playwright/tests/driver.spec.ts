import { expect, test } from '@playwright/test';
import { chromium } from 'playwright';
import {
  evaluateInFixturePage,
  FIXTURE_BASE_URL,
  FIXTURE_PAGE_URL,
  launchChromiumOverCdp,
  type LaunchedChromium,
} from './cdp-launcher';
import { NeverClickError, PlaywrightDriver, StableTimeout } from '../src/index.js';

let launched: LaunchedChromium;
let driver: PlaywrightDriver;

test.beforeEach(async () => {
  launched = await launchChromiumOverCdp();
  driver = new PlaywrightDriver();
});

test.afterEach(async () => {
  await driver?.close();
  await launched?.stop();
});

test('connect attaches to the page whose URL matches', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  expect(await driver.readText({ css: '#model' })).toContain('"dealAmount":""');
});

test('connect waits up to 10 s for a matching page', async () => {
  const late = await launchChromiumOverCdp('about:blank');
  try {
    const browser = await chromium.connectOverCDP(late.cdpUrl);
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    if (!page) throw new Error('about:blank page not found');
    setTimeout(() => {
      void page.goto(`${FIXTURE_BASE_URL}/deal/2`).catch(() => undefined);
    }, 1500);
    const lateDriver = new PlaywrightDriver();
    await lateDriver.connect(late.cdpUrl, FIXTURE_PAGE_URL);
    expect(await lateDriver.readText({ css: '#model' })).toContain('"dealAmount":""');
    await lateDriver.close();
    await browser.close();
  } finally {
    await late.stop();
  }
});

test('locator precedence: formControlName resolves the Angular control', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.type({ formControlName: 'dealAmount' }, '1250000');
  expect(await driver.readValue({ formControlName: 'dealAmount' })).toBe('1250000');
  expect(await driver.readText({ css: '#model' })).toContain('"dealAmount":"1250000"');
});

test('locator precedence: label resolves via the accessible label', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.type({ label: 'Deal amount' }, '99');
  expect(await driver.readValue({ label: 'Deal amount' })).toBe('99');
});

test('type appends by default and replaces when clear is set', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.type({ formControlName: 'dealAmount' }, '1');
  await driver.type({ formControlName: 'dealAmount' }, '2');
  expect(await driver.readValue({ formControlName: 'dealAmount' })).toBe('12');
  await driver.type({ formControlName: 'dealAmount' }, '7', { clear: true });
  expect(await driver.readValue({ formControlName: 'dealAmount' })).toBe('7');
});

test('press sends a key event to the control', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.type({ formControlName: 'dealAmount' }, '12');
  await driver.press({ formControlName: 'dealAmount' }, '3');
  expect(await driver.readValue({ formControlName: 'dealAmount' })).toBe('123');
});

test('locator precedence: role resolves tab buttons by name string and /regex/', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.click({ role: { role: 'tab', name: 'Parties' } });
  await driver.waitFor({ css: '[data-testid="parties-grid"]' }, 'visible', 10_000);
  await driver.click({ role: { role: 'tab', name: '/^deal$/i' } });
  await driver.waitFor({ formControlName: 'dealAmount' }, 'visible', 10_000);
});

test('css with within/nth scopes resolution and count reports matches', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  expect(await driver.count({ css: 'select', within: { css: 'form' } })).toBe(1);
  expect(await driver.count({ formControlName: 'feeType' })).toBe(0);
  await driver.click({ role: { role: 'button', name: 'Add fees' } });
  await driver.waitFor({ formControlName: 'feeType' }, 'attached', 5_000);
  await driver.waitFor({ formControlName: 'feeType' }, 'visible', 5_000);
  expect(await driver.count({ css: 'select', within: { css: 'form' } })).toBe(2);
  expect(await driver.count({ css: 'label', nth: 1 })).toBe(1);
});

test('readValue covers checkbox, select and non-input innerText', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  expect(await driver.readValue({ formControlName: 'isConfidential' })).toBe('false');
  await driver.click({ formControlName: 'isConfidential' });
  expect(await driver.readValue({ formControlName: 'isConfidential' })).toBe('true');
  expect(await driver.readValue({ formControlName: 'currency' })).toBe('');
  expect(await driver.readValue({ css: '#model' })).toContain('"dealAmount"');
});

test('readText returns the inner text of an element', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  expect(await driver.readText({ role: { role: 'button', name: 'Add fees' } })).toBe('Add fees');
});

test('waitFor tracks the searchSelect loading indicator appearing and hiding', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.click({ css: '.fib-select__trigger' });
  await driver.type({ css: '.fib-select__search' }, 'Goldman');
  await driver.waitFor({ css: '.fib-select__loading' }, 'visible', 5_000);
  await driver.waitFor({ css: '.fib-select__loading' }, 'hidden', 10_000);
  expect(await driver.count({ css: '.fib-select__option' })).toBe(2);
});

test('waitStable on the option list resolves after the fixture flicker', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await driver.click({ css: '.fib-select__trigger' });
  const start = Date.now();
  await driver.type({ css: '.fib-select__search' }, 'Goldman');
  await driver.waitStable({ css: '.fib-select__options' }, 300, 10_000);
  expect(Date.now() - start).toBeGreaterThanOrEqual(1_700);
  expect(await driver.count({ css: '.fib-select__option' })).toBe(2);
});

test('waitStable rejects with StableTimeout when maxMs elapses before settling', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  await expect(driver.waitStable({ css: '#model' }, 500, 300)).rejects.toBeInstanceOf(
    StableTimeout,
  );
});

test('ariaSnapshot annotates interactive nodes with usable refs', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  const { yaml, refs } = await driver.ariaSnapshot();
  expect(refs.length).toBeGreaterThan(0);
  const submitLine = yaml.split('\n').find((line) => line.includes('button "Submit"'));
  expect(submitLine).toBeDefined();
  const refMatch = /\[ref=(e\d+)\]\s*$/.exec(submitLine ?? '');
  expect(refMatch).not.toBeNull();
  const ref = refMatch?.[1] ?? '';
  expect(await driver.readText({ ref })).toBe('Submit');
});

test('refs from ariaSnapshot are usable as click targets', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  const { yaml } = await driver.ariaSnapshot();
  const tabLine = yaml.split('\n').find((line) => line.includes('tab "Parties"'));
  const ref = /\[ref=(e\d+)\]/.exec(tabLine ?? '')?.[1] ?? '';
  expect(ref).not.toBe('');
  await driver.click({ ref });
  await driver.waitFor({ css: '[data-testid="parties-grid"]' }, 'visible', 10_000);
});

test('ariaSnapshot honours a scope', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  const scoped = await driver.ariaSnapshot({ css: 'form' });
  expect(scoped.yaml).not.toContain('Submit');
  const full = await driver.ariaSnapshot();
  expect(full.yaml).toContain('Submit');
});

test('setNeverClick blocks the Submit button by locator and by ref', async () => {
  await driver.connect(launched.cdpUrl, FIXTURE_PAGE_URL);
  driver.setNeverClick([{ role: { role: 'button', name: '/^submit$/i' } }]);
  await expect(driver.click({ role: { role: 'button', name: 'Submit' } })).rejects.toBeInstanceOf(
    NeverClickError,
  );
  const { yaml } = await driver.ariaSnapshot();
  const submitLine = yaml.split('\n').find((line) => line.includes('button "Submit"'));
  const ref = /\[ref=(e\d+)\]/.exec(submitLine ?? '')?.[1] ?? '';
  expect(ref).not.toBe('');
  await expect(driver.click({ ref })).rejects.toBeInstanceOf(NeverClickError);
  const submitted = await evaluateInFixturePage(launched.cdpUrl, () => {
    return (window as unknown as { __submitted?: boolean }).__submitted;
  });
  expect(submitted).toBeUndefined();
});
