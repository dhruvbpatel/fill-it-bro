import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// jsdom cannot construct real workers, and the Vite `?url` asset URL is not
// importable in vitest — point the fake worker at the bare specifier instead.
// Runs via test.setupFiles, before PdfViewer's module init (pdfjs.ts keeps a
// pre-set workerSrc).
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// jsdom has no canvas backend and logs a "Not implemented" error for every
// getContext call; stub it to the production-failure shape (null context) so
// the PdfViewer's no-2D fallback path is exercised quietly.
HTMLCanvasElement.prototype.getContext = () => null;
