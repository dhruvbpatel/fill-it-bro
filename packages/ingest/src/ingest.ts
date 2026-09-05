import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { DocumentSet, DocumentSource, Page } from '@fib/contracts';
import { PlaywrightHtmlToPdf } from './htmlToPdf.js';
import type { HtmlToPdf } from './htmlToPdf.js';
import { imageToPdf } from './imageToPdf.js';
import { mergeSources } from './merge.js';
import type { MergePart } from './merge.js';
import { parseMsg } from './msg.js';
import { parsePdf } from './parse.js';

export interface SkippedAttachment {
  name: string;
  mime: string;
  reason: string;
}

export interface IngestDocumentSet extends DocumentSet {
  mergedPdf: Uint8Array;
  skipped?: SkippedAttachment[];
}

export interface IngestDeps {
  parsePdf: (bytes: Uint8Array) => Promise<Page[]>;
  htmlToPdf: HtmlToPdf;
}

export class UnsupportedInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedInput';
  }
}

export const defaultDeps: IngestDeps = { parsePdf, htmlToPdf: new PlaywrightHtmlToPdf() };

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

export async function ingest(files: string[], deps: IngestDeps): Promise<IngestDocumentSet> {
  if (files.length !== 1) {
    throw new UnsupportedInput(`expected exactly one file, got ${files.length}`);
  }
  const file = files[0]!;
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf') return ingestPdf(file, deps);
  if (ext === '.msg') return ingestMsg(file, deps);
  throw new UnsupportedInput(
    `unsupported input '${basename(file)}': only .pdf and .msg are supported`,
  );
}

async function ingestPdf(file: string, deps: IngestDeps): Promise<IngestDocumentSet> {
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function ingestMsg(file: string, deps: IngestDeps): Promise<IngestDocumentSet> {
  const bytes = new Uint8Array(await readFile(file));
  const parsed = parseMsg(bytes);
  const bodyHtml = parsed.bodyHtml ?? `<pre>${escapeHtml(parsed.bodyText)}</pre>`;
  const bodyPdf = await deps.htmlToPdf.render(bodyHtml);

  const parts: MergePart[] = [
    {
      source: { sourceId: 'body', kind: 'emailBody', name: 'Email body', mime: 'text/html' },
      pdf: bodyPdf,
    },
  ];
  const skipped: SkippedAttachment[] = [];
  let attachmentCount = 0;

  for (const attachment of parsed.attachments) {
    let pdf: Uint8Array;
    if (attachment.mime === 'application/pdf') {
      pdf = attachment.bytes;
    } else if (IMAGE_MIME_TYPES.has(attachment.mime)) {
      pdf = await imageToPdf(attachment.bytes, attachment.mime);
    } else {
      skipped.push({
        name: attachment.name,
        mime: attachment.mime,
        reason: `unsupported attachment type '${attachment.mime}'`,
      });
      continue;
    }
    attachmentCount += 1;
    const source: DocumentSource = {
      sourceId: `att-${attachmentCount}`,
      kind: 'attachment',
      name: attachment.name,
      mime: attachment.mime,
    };
    parts.push({ source, pdf });
  }

  const { mergedPdf, manifest, sources } = await mergeSources(parts);
  const pages = await deps.parsePdf(mergedPdf);

  return {
    setId: `set-${randomUUID()}`,
    // parts always has at least the body entry, so sources is non-empty.
    sources: sources as [DocumentSource, ...DocumentSource[]],
    manifest,
    pages,
    mergedPdf,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}
