import { useRef, useState } from 'react';

type FileWithPath = File & { path?: string };

/** Electron exposes absolute paths on dropped/picked File objects; browsers fall back to the name. */
export function filePaths(files: FileList | File[]): string[] {
  return Array.from(files).map((f) => (f as FileWithPath).path ?? f.name);
}

interface DropZoneProps {
  onDrop: (paths: string[]) => void;
  disabled?: boolean;
}

/** Drag & drop plus file picker; accepts `.pdf` and `.msg` (ticket 23). */
export function DropZone({ onDrop, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleFiles = (files: FileList | null): void => {
    if (disabled || !files || files.length === 0) {
      return;
    }
    onDrop(filePaths(files));
  };

  return (
    <section
      className={`drop-zone${over ? ' drop-zone--over' : ''}`}
      data-testid="drop-zone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <p>Drop a PDF or .msg to fill this deal</p>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.msg"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </section>
  );
}
