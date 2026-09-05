import type { DocumentSet, FillEvent, ResolvedField } from '@fib/contracts';
import { deriveStatus, sortFields, type PanelFieldStatus } from '../state/deriveStatus.js';
import { FieldRow } from './FieldRow.js';

interface FieldListProps {
  fields: ResolvedField[];
  events: FillEvent[];
  documentSet?: DocumentSet;
  onOpenCitation?: (fieldId: string, citationIndex: number) => void;
}

interface Entry {
  field: ResolvedField;
  status: PanelFieldStatus;
}

/** Grid cells are addressed `<groupId>[<row>].<colId>` (ticket 26 convention). */
const GRID_CELL = /^(.+)\[(\d+)\]\.(.+)$/;

/**
 * Attention-first sorted field list; grid groups render as collapsible
 * blocks with one row per cell (ticket 23).
 */
export function FieldList({ fields, events, documentSet, onOpenCitation }: FieldListProps) {
  const sorted = sortFields(fields, events);
  const plain: Entry[] = [];
  const groups = new Map<string, Entry[]>();
  for (const field of sorted) {
    const entry: Entry = { field, status: deriveStatus(field, events) };
    const match = GRID_CELL.exec(field.fieldId);
    if (match) {
      const cells = groups.get(match[1]) ?? [];
      cells.push(entry);
      groups.set(match[1], cells);
    } else {
      plain.push(entry);
    }
  }
  return (
    <div data-testid="field-list">
      {plain.map(({ field, status }) => (
        <FieldRow
          key={field.fieldId}
          field={field}
          status={status}
          documentSet={documentSet}
          onOpen={onOpenCitation}
        />
      ))}
      {[...groups.entries()].map(([groupId, cells]) => (
        <GroupBlock
          key={groupId}
          groupId={groupId}
          cells={cells}
          documentSet={documentSet}
          onOpen={onOpenCitation}
        />
      ))}
    </div>
  );
}

interface GroupBlockProps {
  groupId: string;
  cells: Entry[];
  documentSet?: DocumentSet;
  onOpen?: (fieldId: string, citationIndex: number) => void;
}

function GroupBlock({ groupId, cells, documentSet, onOpen }: GroupBlockProps) {
  return (
    <details className="group" data-testid={`group-${groupId}`}>
      <summary>
        {groupId} ({cells.length})
      </summary>
      {cells.map(({ field, status }) => (
        <FieldRow
          key={field.fieldId}
          field={field}
          status={status}
          documentSet={documentSet}
          onOpen={onOpen}
        />
      ))}
    </details>
  );
}
