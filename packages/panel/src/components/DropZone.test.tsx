import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DropZone, filePaths } from './DropZone';

function fileWithPath(path: string): File {
  const file = new File(['bytes'], path.split('/').at(-1) ?? 'file.pdf', {
    type: 'application/pdf',
  });
  Object.defineProperty(file, 'path', { value: path });
  return file;
}

describe('DropZone', () => {
  it('calls onDrop with the file path list on drop', () => {
    const onDrop = vi.fn();
    render(<DropZone onDrop={onDrop} />);
    const zone = screen.getByTestId('drop-zone');
    const pdf = fileWithPath('/tmp/ingest/deal.pdf');
    const msg = fileWithPath('/tmp/ingest/email.msg');
    fireEvent.drop(zone, { dataTransfer: { files: [pdf, msg] } });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(['/tmp/ingest/deal.pdf', '/tmp/ingest/email.msg']);
  });

  it('calls onDrop from the file picker with paths', () => {
    const onDrop = vi.fn();
    render(<DropZone onDrop={onDrop} />);
    const input = screen.getByTestId('drop-zone').querySelector('input[type="file"]');
    expect(input?.getAttribute('accept')).toBe('.pdf,.msg');
    fireEvent.change(input!, { target: { files: [fileWithPath('/tmp/only.pdf')] } });
    expect(onDrop).toHaveBeenCalledWith(['/tmp/only.pdf']);
  });

  it('ignores empty drops and does nothing when disabled', () => {
    const onDrop = vi.fn();
    const { rerender } = render(<DropZone onDrop={onDrop} />);
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [] } });
    expect(onDrop).not.toHaveBeenCalled();
    rerender(<DropZone onDrop={onDrop} disabled />);
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [fileWithPath('/tmp/x.pdf')] },
    });
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe('filePaths', () => {
  it('falls back to the file name when no Electron path is present', () => {
    const plain = new File(['bytes'], 'fallback.msg');
    expect(filePaths([plain])).toEqual(['fallback.msg']);
  });
});
