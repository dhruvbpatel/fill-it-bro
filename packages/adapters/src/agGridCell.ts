import type { LocatorSpec } from '@fib/core';
import { registry, type AdapterCtx, type WidgetAdapter } from './adapter.js';

const DEFAULT_ROW_COUNT_SELECTOR = '.ag-row';
const EDITOR_SELECTOR = '.ag-cell-editor, input, select';
const INNER_CONTROL_SELECTOR = 'input, select';

/**
 * Ensures the grid has a row at `rowIndex` (0-based): while the number of rows matching
 * `rowCountSelector` inside the grid is <= rowIndex, click `addRow` and wait for the new
 * row to be attached (2000 ms). Exported for the executor's `addRow` step.
 */
export async function ensureRow(
  ctx: AdapterCtx,
  gridLocator: LocatorSpec,
  rowIndex: number,
  addRow: LocatorSpec,
  rowCountSelector: string = DEFAULT_ROW_COUNT_SELECTOR,
): Promise<void> {
  while ((await ctx.driver.count({ within: gridLocator, css: rowCountSelector })) <= rowIndex) {
    await ctx.driver.click(addRow);
    await ctx.driver.waitFor(
      { within: gridLocator, css: rowCountSelector, nth: rowIndex },
      'attached',
      2000,
    );
  }
}

export const agGridCellAdapter: WidgetAdapter = {
  control: 'agGridCell',

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string, profile?) {
    const innerControl = profile?.innerControl ?? 'text';
    const inner = registry.get(innerControl);
    if (!inner) {
      throw new Error(`agGridCell: no adapter registered for inner control "${innerControl}"`);
    }

    await ctx.driver.click(target); // scrolls the cell into view
    await ctx.driver.press(target, 'Enter'); // start editing
    // AG Grid's text editor nests the <input> inside a div.ag-cell-editor, so the union
    // selector matches two nodes; nth: 0 targets the editor wrapper itself.
    const editor = { within: target, css: EDITOR_SELECTOR, nth: 0 };
    await ctx.driver.waitFor(editor, 'visible', 2000);
    const innerTarget = { within: target, css: INNER_CONTROL_SELECTOR };

    const via = await inner.write(ctx, innerTarget, value, profile);

    // The inner adapter may already have committed (e.g. the text adapter commits on Tab);
    // only press Enter to commit while the cell's inner editor control is still present.
    if ((await ctx.driver.count(innerTarget)) > 0) {
      await ctx.driver.press(innerTarget, 'Enter');
    }
    await ctx.driver.waitFor(editor, 'hidden', 2000);
    return via;
  },

  async read(ctx: AdapterCtx, target: LocatorSpec): Promise<string | null> {
    return ctx.driver.readText(target);
  },
};
