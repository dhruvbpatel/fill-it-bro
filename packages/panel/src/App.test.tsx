import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionSnapshot } from '@fib/core';
import { App } from './App';
import { MemoryPanelApi } from './api/PanelApi';
import { fixtureSnapshot } from './fixtures';

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
});
