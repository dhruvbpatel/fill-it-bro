import type { DocumentSet, ResolvedField } from '@fib/contracts';
import { citationSourceLabel } from '../state/sourceLabel.js';
import type { PanelFieldStatus } from '../state/deriveStatus.js';
import { StatusBadge } from './StatusBadge.js';

interface FieldRowProps {
  field: ResolvedField;
  status: PanelFieldStatus;
  documentSet?: DocumentSet;
  onOpen?: (fieldId: string, citationIndex: number) => void;
}

/** One field: label, value, status badge and where the value came from. */
export function FieldRow({ field, status, documentSet, onOpen }: FieldRowProps) {
  const citation = field.citations[0];
  return (
    <div className="field-row" data-testid={`field-${field.fieldId}`}>
      <span className="field-row__label">{field.fieldId}</span>
      <button type="button" className="field-row__value" onClick={() => onOpen?.(field.fieldId, 0)}>
        {field.value === null ? '' : String(field.value)}
      </button>
      <StatusBadge status={status} />
      {citation && documentSet && (
        <span className="field-row__source">{citationSourceLabel(citation, documentSet)}</span>
      )}
    </div>
  );
}
