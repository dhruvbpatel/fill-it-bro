import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// The legacy build is used deliberately: it runs in Electron, in jsdom-based
// tests and under Node alike (the modern build hard-crashes under jsdom).
// A host (or a test — jsdom cannot construct real workers) may pre-set
// workerSrc before this module loads; keep theirs in that case.
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

export { pdfjs };
