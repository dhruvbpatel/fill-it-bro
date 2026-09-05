import { expect, test } from '@playwright/test';
import { normalise } from '@fib/core';
import { PlaywrightDriver } from '../../driver-playwright/src/index.js';
import { ensureRow } from '../src/agGridCell.js';
import { registry, type AdapterCtx, type WidgetProfile } from '../src/index.js';
import { FIXTURE_PAGE_URL, launchChromiumOverCdp, type LaunchedChromium } from './cdp-launcher';

let launched: LaunchedChromium;
let driver: PlaywrightDriver;
let ctx: AdapterCtx;
let addRowClicks: number;

const grid = { css: '[data-testid="parties-grid"]' };
const addRow = { role: { role: 'button', name: 'Add row' } };
const textProfile: WidgetProfile = { innerControl: 'text', rowCountSelector: '.ag-row' };
const selectProfile: WidgetProfile = { innerControl: 'select', rowCountSelector: '.ag-row' };

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

  addRowClicks = 0;
  const click = driver.click.bind(driver);
  driver.click = async (t) => {
    if (!('ref' in t) && t.role?.name === 'Add row') addRowClicks += 1;
    await click(t);
  };

  ctx = { driver, matchOption, log: (msg) => console.log(`[fib-aggrid] ${msg}`) };
});

test.afterEach(async () => {
  await driver?.close();
  await launched?.stop();
});

function adapter(): WidgetAdapter {
  const found = registry.get('agGridCell');
  if (!found) throw new Error('adapter "agGridCell" not registered');
  return found;
}

function cell(rowIndex: number, colId: string): { within: typeof grid; css: string } {
  return { within: grid, css: `.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]` };
}

async function openPartiesTab(): Promise<void> {
  const tab = registry.get('tab');
  if (!tab) throw new Error('adapter "tab" not registered');
  await tab.write(ctx, { role: { role: 'tab', name: 'Parties' } }, 'ignored');
  await driver.waitFor({ within: grid, css: '.ag-row' }, 'attached', 10_000);
}

async function modelParties(): Promise<{ partyName: string; role: string; amount: string }[]> {
  const text = await driver.readText({ css: '#model' });
  const model: unknown = JSON.parse(text);
  if (!model || typeof model !== 'object' || !('parties' in model)) {
    throw new Error(`#model JSON has no "parties": ${text}`);
  }
  return model.parties as { partyName: string; role: string; amount: string }[];
}

test('fills 2 rows x (partyName, role, amount) from 1 initial row with exactly one Add-row click', async () => {
  await openPartiesTab();
  const agGrid = adapter();

  await ensureRow(ctx, grid, 1, addRow, '.ag-row');

  const rows = [
    { partyName: 'Acme Corp', role: 'Issuer', amount: '1000' },
    { partyName: 'Beta LLC', role: 'Guarantor', amount: '2000' },
  ];
  for (const [i, row] of rows.entries()) {
    await agGrid.write(ctx, cell(i, 'partyName'), row.partyName, textProfile);
    await agGrid.write(ctx, cell(i, 'role'), row.role, selectProfile);
    await agGrid.write(ctx, cell(i, 'amount'), row.amount, textProfile);
  }

  expect(addRowClicks).toBe(1);
  await expect.poll(modelParties, { timeout: 5_000 }).toEqual(rows);
});

test('role cell delegates to the select adapter and matches "agent" to "Agent"', async () => {
  await openPartiesTab();
  const agGrid = adapter();

  await agGrid.write(ctx, cell(0, 'role'), 'agent', selectProfile);

  expect(await agGrid.read(ctx, cell(0, 'role'))).toBe('Agent');
  await expect
    .poll(modelParties, { timeout: 5_000 })
    .toEqual([{ partyName: '', role: 'Agent', amount: '' }]);
});

test('re-writing an existing cell replaces, not appends', async () => {
  await openPartiesTab();
  const agGrid = adapter();

  await agGrid.write(ctx, cell(0, 'partyName'), 'First Name', textProfile);
  await agGrid.write(ctx, cell(0, 'partyName'), 'Second Name', textProfile);

  expect(await agGrid.read(ctx, cell(0, 'partyName'))).toBe('Second Name');
  await expect
    .poll(modelParties, { timeout: 5_000 })
    .toEqual([{ partyName: 'Second Name', role: '', amount: '' }]);
});
