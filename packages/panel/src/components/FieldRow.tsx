import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { DocumentSet, ResolvedField } from '@fib/contracts';
import { citationSourceLabel } from '../state/sourceLabel.js';
import type { PanelFieldStatus } from '../state/deriveStatus.js';
import { StatusBadge } from './StatusBadge.js';

interface FieldRowProps {
  field: ResolvedField;
  status: PanelFieldStatus;
  documentSet?: DocumentSet;
  onOpen?: (fieldId: string, citationIndex: number) => void;
  /** Ticket 26: Enter on the inline editor commits through here; Escape never does. */
  onEdit?: (fieldId: string, value: string) => void;
  /** Enum fields render a `<select>` instead of a free-text input. */
  options?: readonly string[];
}

/** One field: label, value, status badge and where the value came from. */
export function FieldRow({ field, status, documentSet, onOpen, onEdit, options }: FieldRowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const citation = field.citations[0];
  const value = field.value === null ? '' : String(field.value);

  const startEdit = () => {
    if (!onEdit) return;
    setDraft(value);
  };
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    onEdit?.(field.fieldId, draft);
  };
  const cancel = () => {
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <div className="field-row" data-testid={`field-${field.fieldId}`}>
      <span className="field-row__label">{field.fieldId}</span>
      {draft !== null && onEdit ? (
        options && options.length > 0 ? (
          <select
            className="field-row__editor"
            data-testid={`edit-${field.fieldId}`}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="field-row__editor"
            data-testid={`edit-${field.fieldId}`}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
        )
      ) : (
        <button
          type="button"
          className="field-row__value"
          title={onEdit ? 'Click to edit' : undefined}
          onClick={startEdit}
        >
          {value}
        </button>
      )}
      <StatusBadge status={status} />
      {citation && documentSet && (
        <button
          type="button"
          className="field-row__source"
          data-testid={`source-${field.fieldId}`}
          onClick={() => onOpen?.(field.fieldId, 0)}
        >
          {citationSourceLabel(citation, documentSet)}
        </button>
      )}
    </div>
  );
}
