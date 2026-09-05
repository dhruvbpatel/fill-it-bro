import { app, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentSet } from '@fib/contracts';
import { ElectronHtmlToPdf } from './htmlToPdf.js';
import type {
  IngestStage,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from '../ingest-worker/protocol.js';
import { toArrayBuffer } from '../ingest-worker/protocol.js';

export interface IngestProgress {
  stage: IngestStage;
  pct: number;
}

export interface IngestFilesResult {
  documentSet: DocumentSet;
  mergedPdf: ArrayBuffer;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'ingest-worker', 'index.js');

interface Job {
  onProgress: (progress: IngestProgress) => void;
  resolve: (result: IngestFilesResult) => void;
  reject: (err: Error) => void;
}

let worker: UtilityProcess | null = null;
let nextId = 1;
const jobs = new Map<number, Job>();

function handleWorkerMessage(message: WorkerOutboundMessage): void {
  const job = jobs.get(message.id);
  if (!job) return;
  switch (message.type) {
    case 'progress':
      job.onProgress({ stage: message.stage, pct: message.pct });
      break;
    case 'needHtmlToPdf':
      void renderBodyPdf(message.id, message.html);
      break;
    case 'done':
      jobs.delete(message.id);
      job.resolve({ documentSet: message.documentSet, mergedPdf: message.mergedPdf });
      break;
    case 'error':
      jobs.delete(message.id);
      job.reject(new Error(message.message));
      break;
  }
}

/** Renders the email body HTML in main (real Chromium) and replies to the worker. */
async function renderBodyPdf(id: number, html: string): Promise<void> {
  const reply = (message: WorkerInboundMessage): void => {
    if (jobs.has(id)) worker?.postMessage(message);
  };
  try {
    const pdf = await new ElectronHtmlToPdf().render(html);
    reply({ type: 'htmlToPdf', id, pdf: toArrayBuffer(pdf) });
  } catch (err) {
    reply({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

function ensureWorker(): UtilityProcess {
  if (worker !== null) return worker;
  const child = utilityProcess.fork(workerPath);
  child.on('message', (message: unknown) => handleWorkerMessage(message as WorkerOutboundMessage));
  child.on('exit', () => {
    worker = null;
    for (const [id, job] of jobs) {
      job.reject(new Error(`ingest worker exited before job ${id} completed`));
    }
    jobs.clear();
  });
  worker = child;
  return child;
}

/** Ingests files off the main thread in the shared utility process. */
export function ingestFiles(
  paths: string[],
  onProgress: (progress: IngestProgress) => void,
): Promise<IngestFilesResult> {
  const child = ensureWorker();
  const id = nextId++;
  return new Promise<IngestFilesResult>((resolve, reject) => {
    jobs.set(id, { onProgress, resolve, reject });
    child.postMessage({ type: 'ingest', id, paths } satisfies WorkerInboundMessage);
  });
}

app.on('quit', () => {
  worker?.kill();
  worker = null;
});
