import { Component, effect, input, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import type { CellValueChangedEvent, ColDef } from 'ag-grid-community';
import type { PartyRow } from './party-row';
import { NativeSelectCellEditor } from './native-select-cell-editor';

type PartyFormGroup = FormGroup<{
  partyName: FormControl<string>;
  role: FormControl<string>;
  amount: FormControl<string>;
}>;

@Component({
  selector: 'app-parties-grid',
  standalone: true,
  imports: [AgGridAngular],
  templateUrl: './parties-grid.component.html',
  styleUrl: './parties-grid.component.css',
})
export class PartiesGridComponent {
  partiesArray = input.required<FormArray<PartyFormGroup>>();

  private rowsSignal = signal<PartyRow[]>([]);
  rows = this.rowsSignal.asReadonly();

  columnDefs: ColDef<PartyRow>[] = [
    { field: 'partyName', headerName: 'Party name', editable: true, cellEditor: 'agTextCellEditor' },
    {
      field: 'role',
      headerName: 'Role',
      editable: true,
      cellEditor: NativeSelectCellEditor,
      cellEditorParams: { values: ['Issuer', 'Agent', 'Guarantor'] },
    },
    { field: 'amount', headerName: 'Amount', editable: true, cellEditor: 'agTextCellEditor' },
  ];

  constructor() {
    // partiesArray is the exact FormArray instance owned by the parent's form, so
    // subscribing here (rather than duplicating rows as separate component state)
    // means grid edits bubble straight into the parent form's valueChanges / #model.
    effect((onCleanup) => {
      const array = this.partiesArray();
      // FormArray#value/valueChanges are typed Partial<T> (Angular typed-forms convention,
      // since disabled controls are excluded from `.value`); getRawValue() gives the fully
      // typed snapshot our grid's rowData actually needs.
      this.rowsSignal.set(array.getRawValue());
      const sub = array.valueChanges.subscribe(() => this.rowsSignal.set(array.getRawValue()));
      onCleanup(() => sub.unsubscribe());
    }, { allowSignalWrites: true });
  }

  addRow(): void {
    this.partiesArray().push(
      new FormGroup({
        partyName: new FormControl('', { nonNullable: true }),
        role: new FormControl('', { nonNullable: true }),
        amount: new FormControl('', { nonNullable: true }),
      }),
    );
  }

  onCellValueChanged(event: CellValueChangedEvent<PartyRow>): void {
    if (event.rowIndex == null || !event.data) {
      return;
    }
    const group = this.partiesArray().at(event.rowIndex);
    if (group) {
      group.patchValue(event.data, { emitEvent: true });
    }
  }
}
