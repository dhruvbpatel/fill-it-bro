import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ResolvedField } from '@fib/contracts';
import { fixtureDocumentSet } from '../fixtures';
import { FieldRow } from './FieldRow';

function field(overrides: Partial<ResolvedField> = {}): ResolvedField {
  return {
    fieldId: 'dealAmount',
    value: '25000000',
    valueType: 'string',
    status: 'found',
    confidence: 0.9,
    sourceId: 'body',
    reason: null,
    citations: [],
    ...overrides,
  };
}

describe('FieldRow inline edit', () => {
  it('clicking the value opens an inline input with the current value', () => {
    render(<FieldRow field={field()} status="verified" onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '25000000' }));
    const editor = screen.getByTestId('edit-dealAmount') as HTMLInputElement;
    expect(editor.tagName).toBe('INPUT');
    expect(editor.value).toBe('25000000');
  });

  it('Enter commits through onEdit with the typed value', () => {
    const onEdit = vi.fn();
    render(<FieldRow field={field()} status="verified" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: '25000000' }));
    const editor = screen.getByTestId('edit-dealAmount');
    fireEvent.change(editor, { target: { value: '2000000' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('dealAmount', '2000000');
    expect(screen.queryByTestId('edit-dealAmount')).toBeNull();
  });

  it('Escape cancels: nothing is dispatched and the old value remains', () => {
    const onEdit = vi.fn();
    render(<FieldRow field={field()} status="verified" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: '25000000' }));
    const editor = screen.getByTestId('edit-dealAmount');
    fireEvent.change(editor, { target: { value: '999' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('edit-dealAmount')).toBeNull();
    expect(screen.getByRole('button', { name: '25000000' })).not.toBeNull();
  });

  it('enum fields render a select and commit the chosen option', () => {
    const onEdit = vi.fn();
    render(
      <FieldRow
        field={field({ fieldId: 'currency', value: 'USD' })}
        status="verified"
        onEdit={onEdit}
        options={['USD', 'EUR', 'GBP']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'USD' }));
    const editor = screen.getByTestId('edit-currency') as HTMLSelectElement;
    expect(editor.tagName).toBe('SELECT');
    expect(editor.options).toHaveLength(3);
    fireEvent.change(editor, { target: { value: 'EUR' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('currency', 'EUR');
  });

  it('keeps the grid-cell fieldId intact when committing', () => {
    const onEdit = vi.fn();
    render(
      <FieldRow
        field={field({ fieldId: 'parties[0].amount', value: '1000000' })}
        status="verified"
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '1000000' }));
    fireEvent.change(screen.getByTestId('edit-parties[0].amount'), {
      target: { value: '5550000' },
    });
    fireEvent.keyDown(screen.getByTestId('edit-parties[0].amount'), { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('parties[0].amount', '5550000');
  });

  it('opens the citation from the source label, not the value', () => {
    const onOpen = vi.fn();
    const citable = field({
      citations: [
        {
          mergedPage: 1,
          boxes: [],
          quote: '25,000,000',
          sourceId: 'body',
          sourcePage: 1,
        },
      ],
    });
    render(
      <FieldRow
        field={citable}
        status="verified"
        documentSet={fixtureDocumentSet}
        onOpen={onOpen}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('source-dealAmount'));
    expect(onOpen).toHaveBeenCalledWith('dealAmount', 0);
  });
});
