# 18: agGridCell adapter

**What to build:** Filling any cell of an AG Grid by row index and column id, adding rows when needed, delegating the actual editing to the cell's inner control adapter, and reading the committed cell text back.

**Blocked by:** 16 (Basic adapters)

**Status:** ready-for-agent

## Do exactly this
- `packages/adapters/src/agGridCell.ts`. Target spec for a cell is built by the executor as `{ within: gridLocator, css: '.ag-row[row-index="<i>"] .ag-cell[col-id="<colId>"]' }`; the adapter receives `profile` = `{ innerControl: 'text'|'select'|'searchSelect', addRow?: LocatorSpec, rowCountSelector: '.ag-row' }` (executor fills this from the grid config; add `agGrid` profile keys to the `widget-profiles` schema and regen contracts).
- `ensureRow(ctx, gridLocator, rowIndex, addRow)`: while `count({within: grid, css: rowCountSelector}) <= rowIndex` click `addRow` and `waitFor` the new row `attached` (2000 ms). Exported for the executor's `addRow` step.
- `write`: scroll cell into view (`click`), `press('Enter')` to start editing, `waitFor({within: cell, css: '.ag-cell-editor, input, select'}, 'visible', 2000)`, delegate to `registry.get(innerControl).write` with target `{within: cell, css: 'input, select'}`, `press('Enter')` to commit, `waitFor(cellEditor, 'hidden', 2000)`.
- `read`: `readText(cell)`.

## Acceptance criteria
- [ ] Fixture: fill 2 rows × (partyName, role, amount); starting from 1 row → exactly one "Add row" click; `#model.parties` equals the written rows.
- [ ] `role` cell uses select delegation and matches "agent" → "Agent".
- [ ] Re-writing an existing cell replaces, not appends.
