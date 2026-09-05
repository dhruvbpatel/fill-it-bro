import type { DocumentSet } from '@fib/contracts';

/** Ingest pipeline stages, in the order the worker emits them. */
export type IngestStage = 'split' | 'renderBody' | 'merge' | 'parse';

/** Main → worker messages. */
export type WorkerInboundMessage =
  | { type: 'ingest'; id: number; paths: string[] }
  | { type: 'htmlToPdf'; id: number; pdf: ArrayBuffer }
  | { type: 'error'; id: number; message: string };

/** Worker → main messages. */
export type WorkerOutboundMessage =
  | { type: 'progress'; id: number; stage: IngestStage; pct: number }
  | { type: 'needHtmlToPdf'; id: number; html: string }
  | { type: 'done'; id: number; documentSet: DocumentSet; mergedPdf: ArrayBuffer }
  | { type: 'error'; id: number; message: string };

/** Copies a typed array's bytes into a standalone ArrayBuffer for posting over IPC. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
