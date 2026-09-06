import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionSnapshot } from '@fib/core';
import { App } from './App';
import { MemoryPanelApi } from './api/PanelApi';
import { fixtureFields, fixtureSnapshot } from './fixtures';

function fileWithPath(path: string): File {
  const file = new File(['bytes'], path.split('/').at(-1) ?? 'file.pdf');
  Object.defineProperty(file, 'path', { value: path });
  return file;
}

describe('App', () => {
  it('dropping a file calls dropFiles with the path list', () => {
    const api = new MemoryPanelApi({ ...fixtureSnapshot(), state: 'formReady' });
    render(<App api={api} />);
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [fileWithPath('/tmp/deal.pdf'), fileWithPath('/tmp/body.msg')] },
    });
    expect(api.calls.droppedFiles).toEqual([['/tmp/deal.pdf', '/tmp/body.msg']]);
  });

  it('shows progress and the field list from the snapshot', () => {
    const api = new MemoryPanelApi();
    render(<App api={api} />);
    expect(screen.getByTestId('field-list')).not.toBeNull();
    expect(screen.getByTestId('field-issuerName')).not.toBeNull();
    const row = within(screen.getByTestId('field-issuerName'));
    expect(row.getByText('from sample.msg › attachment 1, page 2')).not.toBeNull();
  });

  it('shows the step counter while filling', () => {
    const api = new MemoryPanelApi({ ...fixtureSnapshot(), state: 'filling' });
    render(<App api={api} />);
    expect(screen.getByTestId('progress-bar')).not.toBeNull();
    expect(screen.getByTestId('step-counter').textContent).toBe('4/4 steps');
  });

  it('re-renders when the api emits a new snapshot', () => {
    const api = new MemoryPanelApi({ ...fixtureSnapshot(), fields: [], state: 'formReady' });
    render(<App api={api} />);
    expect(screen.getByTestId('drop-zone')).not.toBeNull();
    const next: SessionSnapshot = { ...fixtureSnapshot(), state: 'filling' };
    act(() => api.emit(next));
    expect(screen.getByTestId('progress-bar')).not.toBeNull();
    expect(screen.getByTestId('field-list')).not.toBeNull();
  });

  it('clicking a source label opens the viewer on the citation page', async () => {
    const api = new MemoryPanelApi();
    render(<App api={api} />);
    fireEvent.click(
      within(screen.getByTestId('field-issuerName')).getByTestId('source-issuerName'),
    );
    expect(await screen.findByTestId('pdf-viewer')).not.toBeNull();
    expect(screen.getByTestId('page-indicator').textContent).toBe('3 / 4');
    expect(screen.getByTestId('doc-switcher')).not.toBeNull();
    // MemoryPanelApi serves placeholder bytes, so the parse fails gracefully.
    await screen.findByTestId('viewer-error');
    // Back to the field list.
    fireEvent.click(screen.getByTestId('viewer-close'));
    expect(screen.getByTestId('field-list')).not.toBeNull();
  });

  it('cycles between multiple citations of the same field', async () => {
    const fields = fixtureFields.map((f) =>
      f.fieldId === 'dealAmount'
        ? {
            ...f,
            citations: [
              ...f.citations,
              {
                mergedPage: 4,
                boxes: [{ x: 10, y: 20, w: 30, h: 40 }],
                quote: 'fee',
                sourceId: 'att-2',
                sourcePage: 1,
              },
            ],
          }
        : f,
    );
    const api = new MemoryPanelApi({ ...fixtureSnapshot(), fields });
    render(<App api={api} />);
    fireEvent.click(
      within(screen.getByTestId('field-dealAmount')).getByTestId('source-dealAmount'),
    );
    expect(await screen.findByTestId('pdf-viewer')).not.toBeNull();
    expect(screen.getByTestId('page-indicator').textContent).toBe('1 / 4');
    expect(screen.getByTestId('citation-cycler').textContent).toBe('1/2');
    fireEvent.click(screen.getByTestId('citation-cycler'));
    expect(screen.getByTestId('page-indicator').textContent).toBe('4 / 4');
    expect(screen.getByTestId('citation-cycler').textContent).toBe('2/2');
  });

  it('committing an inline edit re-pushes through api.editField', () => {
    const api = new MemoryPanelApi();
    render(<App api={api} />);
    fireEvent.click(
      within(screen.getByTestId('field-dealAmount')).getByRole('button', { name: '25000000' }),
    );
    const editor = screen.getByTestId('edit-dealAmount');
    fireEvent.change(editor, { target: { value: '2000000' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(api.calls.edits).toEqual([{ fieldId: 'dealAmount', value: '2000000' }]);
  });
});
