import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DocumentSet, ResolvedField } from '@fib/contracts';
import { citationSourceLabel, sourceDisplayName } from '../state/sourceLabel';
import { fixtureDocumentSet } from '../fixtures';
import { FieldList } from './FieldList';

const documentSet: DocumentSet = {
  ...fixtureDocumentSet,
  sources: [
    { sourceId: 'body', kind: 'emailBody', name: 'sample.msg', mime: 'message/rfc822' },
    { sourceId: 'att-1', kind: 'attachment', name: 'attachment 1', mime: 'application/pdf' },
    { sourceId: 'att-2', kind: 'attachment', name: 'attachment 2', mime: 'image/png' },
  ],
  manifest: [
    { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
    { mergedPage: 2, sourceId: 'att-1', sourcePage: 1 },
    { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
    { mergedPage: 4, sourceId: 'att-2', sourcePage: 1 },
  ],
};

function fieldWithCitation(overrides: Partial<ResolvedField> = {}): ResolvedField {
  return {
    fieldId: 'issuerName',
    value: 'Goldman Sachs Incorporated',
    valueType: 'string',
    status: 'found',
    confidence: 0.97,
    sourceId: 'att-1',
    reason: null,
    citations: [
      {
        mergedPage: 3,
        boxes: [{ x: 72, y: 90, w: 220, h: 12 }],
        quote: 'Goldman Sachs Incorporated',
        sourceId: 'att-1',
        sourcePage: 2,
      },
    ],
    ...overrides,
  };
}

describe('citation source labels', () => {
  it('renders "from sample.msg › attachment 1, page 2" for a manifest hit on att-1/2', () => {
    const label = citationSourceLabel(
      { mergedPage: 3, boxes: [], quote: 'x', sourceId: 'att-1', sourcePage: 2 },
      documentSet,
    );
    expect(label).toBe('from sample.msg › attachment 1, page 2');
  });

  it('renders the bare source name for the email body', () => {
    const label = citationSourceLabel(
      { mergedPage: 1, boxes: [], quote: 'x', sourceId: 'body', sourcePage: 1 },
      documentSet,
    );
    expect(label).toBe('from sample.msg, page 1');
  });

  it('falls back to the attachment name without an email parent', () => {
    expect(sourceDisplayName(documentSet.sources[1], [documentSet.sources[1]])).toBe(
      'attachment 1',
    );
  });
});

describe('FieldList', () => {
  it('renders the source label on a field row', () => {
    render(<FieldList fields={[fieldWithCitation()]} events={[]} documentSet={documentSet} />);
    expect(screen.getByText('from sample.msg › attachment 1, page 2')).not.toBeNull();
  });

  it('opens the first citation from the source label', () => {
    const onOpenCitation = vi.fn();
    render(
      <FieldList
        fields={[fieldWithCitation()]}
        events={[]}
        documentSet={documentSet}
        onOpenCitation={onOpenCitation}
      />,
    );
    fireEvent.click(screen.getByTestId('source-issuerName'));
    expect(onOpenCitation).toHaveBeenCalledWith('issuerName', 0);
  });

  it('committing an inline edit calls onEditField with the row field id', () => {
    const onEditField = vi.fn();
    render(
      <FieldList
        fields={[fieldWithCitation()]}
        events={[]}
        documentSet={documentSet}
        onEditField={onEditField}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Goldman Sachs Incorporated' }));
    const editor = screen.getByTestId('edit-issuerName');
    fireEvent.change(editor, { target: { value: 'Goldman Sachs Group' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onEditField).toHaveBeenCalledWith('issuerName', 'Goldman Sachs Group');
  });

  it('renders grid groups as a collapsible block with one row per cell', () => {
    const cells: ResolvedField[] = [0, 1].flatMap((row) =>
      ['partyName', 'role', 'amount'].map((colId) =>
        fieldWithCitation({ fieldId: `parties[${row}].${colId}`, value: `v-${row}-${colId}` }),
      ),
    );
    render(<FieldList fields={cells} events={[]} documentSet={documentSet} />);
    const group = screen.getByTestId('group-parties');
    expect(group.tagName).toBe('DETAILS');
    for (const row of [0, 1]) {
      for (const colId of ['partyName', 'role', 'amount']) {
        expect(screen.getByTestId(`field-parties[${row}].${colId}`)).not.toBeNull();
      }
    }
  });

  it('orders rows attention-first', () => {
    const fields = [
      fieldWithCitation({ fieldId: 'ok', value: 'fine' }), // no events -> pending
      fieldWithCitation({
        fieldId: 'missing',
        value: null,
        status: 'notFound',
        citations: [],
      }),
    ];
    render(<FieldList fields={fields} events={[]} documentSet={documentSet} />);
    const ids = Array.from(document.querySelectorAll('.field-row')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['field-missing', 'field-ok']);
  });
});
