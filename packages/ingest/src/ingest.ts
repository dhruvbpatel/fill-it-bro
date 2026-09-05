import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { DocumentSet, Page } from '@fib/contracts';
import { parsePdf } from './parse.js';

export interface IngestDocumentSet extends DocumentSet {
  mergedPdf: Uint8Array;
}

export interface IngestDeps {
  parsePdf: (bytes: Uint8Array) => Promise<Page[]>;
}

export class UnsupportedInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedInput';
  }
}

export const defaultDeps: IngestDeps = { parsePdf };

export async function ingest(files: string[], deps: IngestDeps): Promise<IngestDocumentSet> {
  if (files.length !== 1) {
    throw new UnsupportedInput(`expected exactly one file, got ${files.length}`);
  }
  const file = files[0];
  if (extname(file).toLowerCase() !== '.pdf') {
    throw new UnsupportedInput(`unsupported input '${basename(file)}': only .pdf is supported`);
  }
  const bytes = new Uint8Array(await readFile(file));
  const pages = await deps.parsePdf(bytes);
  return {
    setId: `set-${randomUUID()}`,
    sources: [
      { sourceId: 'upload-1', kind: 'upload', name: basename(file), mime: 'application/pdf' },
    ],
    manifest: pages.map((_, i) => ({ mergedPage: i + 1, sourceId: 'upload-1', sourcePage: i + 1 })),
    pages,
    mergedPdf: bytes,
  };
}
