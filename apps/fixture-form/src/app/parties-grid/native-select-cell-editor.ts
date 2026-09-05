import type { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';

interface NativeSelectEditorParams extends ICellEditorParams {
  values?: string[];
}

/**
 * Cell editor rendering a native <select> (plus <option> children) inside the cell, so the
 * agGridCell adapter can delegate to the select widget adapter, which drives native selects
 * via option elements and selectOption-by-label.
 */
export class NativeSelectCellEditor implements ICellEditorComp {
  private params!: NativeSelectEditorParams;
  private select!: HTMLSelectElement;
  private changed = false;

  init(params: NativeSelectEditorParams): void {
    this.params = params;
    this.select = document.createElement('select');
    this.select.className = 'ag-cell-editor ag-cell-select';
    const values = this.params.values ?? [];
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.select.appendChild(option);
    }
    const current = String(this.params.value ?? '');
    this.select.value = values.includes(current) ? current : (values[0] ?? '');
    this.select.addEventListener('change', () => {
      this.changed = true;
    });
  }

  getGui(): HTMLElement {
    return this.select;
  }

  getValue(): string {
    // AG Grid can stop the editor without user interaction (e.g. focus races when edit
    // moves cell-to-cell); in that case report the row's original value, not whatever the
    // dropdown happened to display.
    return this.changed ? this.select.value : String(this.params.value ?? '');
  }

  afterGuiAttached(): void {
    this.select.focus();
  }

  focusIn(): void {
    this.select.focus();
  }

  isPopup(): boolean {
    return false;
  }
}
