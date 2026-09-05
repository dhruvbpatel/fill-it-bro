import { describe, expect, it } from 'vitest';
import type { SessionSnapshotPayload } from '@fib/contracts';
import type { SessionSnapshot } from '@fib/core';
import { ElectronPanelApi, MemoryPanelApi } from './PanelApi';
import { fixtureSnapshot } from '../fixtures';

function fakeFib() {
  return {
    listeners: [] as ((payload: SessionSnapshotPayload) => void)[],
    dropped: [] as string[][],
    edits: [] as { fieldId: string; value: string }[],
    viewer: [] as { fieldId: string }[],
    onSessionSnapshot(listener: (payload: SessionSnapshotPayload) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    },
    async filesDropped(p: { paths: string[] }): Promise<void> {
      this.dropped.push(p.paths);
    },
    async fieldEdit(p: { fieldId: string; value: string }): Promise<void> {
      this.edits.push(p);
    },
    async viewerOpen(p: { fieldId: string }): Promise<void> {
      this.viewer.push(p);
    },
  };
}

describe('ElectronPanelApi', () => {
  it('maps onSnapshot payloads to SessionSnapshot callbacks', () => {
    const fib = fakeFib();
    const api = new ElectronPanelApi(fib);
    const seen: SessionSnapshot[] = [];
    const off = api.onSnapshot((s) => seen.push(s));
    expect(fib.listeners).toHaveLength(1);
    const payload: SessionSnapshotPayload = { state: 'review', fields: [], fillEvents: [] };
    fib.listeners[0](payload);
    expect(seen).toEqual([payload]);
    off();
    expect(fib.listeners).toHaveLength(0);
  });

  it('routes dropFiles, editField and openCitation over the bridge', async () => {
    const fib = fakeFib();
    const api = new ElectronPanelApi(fib);
    await api.dropFiles(['/tmp/a.pdf']);
    expect(fib.dropped).toEqual([['/tmp/a.pdf']]);
    await api.editField('dealAmount', '42');
    expect(fib.edits).toEqual([{ fieldId: 'dealAmount', value: '42' }]);
    await api.openCitation('issuerName', 0);
    expect(fib.viewer).toEqual([{ fieldId: 'issuerName' }]);
  });

  it('returns empty bytes from getMergedPdf until the bridge exposes it', async () => {
    const api = new ElectronPanelApi(fakeFib());
    expect(await api.getMergedPdf()).toEqual(new Uint8Array());
  });

  it('forwards getMergedPdf when the bridge provides it', async () => {
    const fib = Object.assign(fakeFib(), {
      getMergedPdf: async () => new Uint8Array([1, 2, 3]),
    });
    const api = new ElectronPanelApi(fib);
    expect(await api.getMergedPdf()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('throws a helpful error when window.fib is missing', () => {
    expect(() => new ElectronPanelApi()).toThrow(/window\.fib is not available/);
  });
});

describe('MemoryPanelApi', () => {
  it('serves fixture data and records every call', async () => {
    const api = new MemoryPanelApi();
    const seen: SessionSnapshot[] = [];
    const off = api.onSnapshot((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0].state).toBe('review');

    await api.dropFiles(['/tmp/a.msg']);
    await api.editField('dealAmount', '100');
    await api.openCitation('issuerName', 0);

    expect(api.calls.droppedFiles).toEqual([['/tmp/a.msg']]);
    expect(api.calls.edits).toEqual([{ fieldId: 'dealAmount', value: '100' }]);
    expect(api.calls.citations).toEqual([{ fieldId: 'issuerName', citationIndex: 0 }]);
    expect(await api.getMergedPdf()).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    );

    off();
    api.emit(fixtureSnapshot());
    expect(seen).toHaveLength(1);
  });
});
