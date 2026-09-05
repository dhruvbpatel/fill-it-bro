import { ingest, parsePdf } from '@fib/ingest';
import type { HtmlToPdf, IngestDeps } from '@fib/ingest';
import type { WorkerInboundMessage, WorkerOutboundMessage } from './protocol.js';
import { toArrayBuffer } from './protocol.js';

const port = process.parentPort;

let pendingHtmlToPdf: { resolve: (pdf: ArrayBuffer) => void; reject: (err: Error) => void } | null =
  null;

function send(message: WorkerOutboundMessage): void {
  port.postMessage(message);
}

port.on('message', (event) => {
  const message = event.data as WorkerInboundMessage;
  switch (message.type) {
    case 'ingest':
      void runIngest(message.id, message.paths);
      break;
    case 'htmlToPdf': {
      const pending = pendingHtmlToPdf;
      pendingHtmlToPdf = null;
      pending?.resolve(message.pdf);
      break;
    }
    case 'error': {
      // Main failed to service a needHtmlToPdf round-trip; surface it through
      // the awaiting render() so ingest() unwinds and reports the job failed.
      const pending = pendingHtmlToPdf;
      pendingHtmlToPdf = null;
      pending?.reject(new Error(message.message));
      break;
    }
  }
});

async function runIngest(id: number, paths: string[]): Promise<void> {
  try {
    send({ type: 'progress', id, stage: 'split', pct: 10 });

    // HTML rendering needs a real Chromium; the utility process has none, so
    // the body PDF is produced by main (ElectronHtmlToPdf) over a round-trip.
    const htmlToPdf: HtmlToPdf = {
      async render(html) {
        send({ type: 'progress', id, stage: 'renderBody', pct: 35 });
        send({ type: 'needHtmlToPdf', id, html });
        const pdf = await new Promise<ArrayBuffer>((resolve, reject) => {
          pendingHtmlToPdf = { resolve, reject };
        });
        // With the body PDF back, all that remains before LiteParse is the merge.
        send({ type: 'progress', id, stage: 'merge', pct: 60 });
        return new Uint8Array(pdf);
      },
    };

    const deps: IngestDeps = {
      htmlToPdf,
      parsePdf: async (bytes) => {
        send({ type: 'progress', id, stage: 'parse', pct: 80 });
        return parsePdf(bytes);
      },
    };

    const { mergedPdf, ...documentSet } = await ingest(paths, deps);
    send({ type: 'done', id, documentSet, mergedPdf: toArrayBuffer(mergedPdf) });
  } catch (err) {
    send({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}
