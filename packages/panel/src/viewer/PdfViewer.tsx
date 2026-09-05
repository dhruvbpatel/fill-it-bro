import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Box, DocumentSource, ManifestEntry } from '@fib/contracts';
import { pdfjs } from './pdfjs.js';
import { sourceRanges } from './sourceRanges.js';

interface PdfViewerProps {
  /** Merged PDF bytes (client-only; never sent anywhere). */
  pdf: Uint8Array;
  /** 1-based merged page to show. */
  page: number;
  /** Citation boxes in PDF points, top-left origin (LiteParse geometry). */
  boxes: Box[];
  manifest: ManifestEntry[];
  sources: DocumentSource[];
  onPageChange: (page: number) => void;
}

/**
 * One merged-PDF page on a canvas with citation highlight overlays.
 * Overlay geometry is computed from the page viewport, so highlights stay
 * correct even where a 2D context is unavailable (e.g. jsdom tests).
 */
export function PdfViewer({ pdf, page, boxes, manifest, sources, onPageChange }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ pdf: Uint8Array; doc: PDFDocumentProxy } | null>(null);
  const [scale, setScale] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const total = manifest.length;
  const ranges = sourceRanges(manifest, sources);
  const currentSource = manifest.find((m) => m.mergedPage === page)?.sourceId ?? '';

  useEffect(() => {
    const measure = () => setWidth(containerRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    const run = async () => {
      try {
        setError(null);
        // pdf.js may detach the buffer it is given; hand it a copy.
        let doc = docRef.current?.pdf === pdf ? docRef.current.doc : null;
        if (!doc) {
          docRef.current?.doc.destroy();
          doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
          docRef.current = { pdf, doc };
        }
        if (cancelled) return;
        const pageNumber = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport1 = pdfPage.getViewport({ scale: 1 });
        const nextScale = width > 0 ? width / viewport1.width : 1;
        const viewport = pdfPage.getViewport({ scale: nextScale });
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
            task = renderTask;
            await renderTask.promise;
          }
        }
        if (cancelled) return;
        setScale(nextScale);
        const first = boxes[0];
        const container = containerRef.current;
        if (first && container) {
          const centreY = (first.y + first.h / 2) * nextScale;
          container.scrollTop = Math.max(0, centreY - container.clientHeight / 2);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width, boxes]);

  return (
    <section className="viewer" data-testid="pdf-viewer">
      <div className="viewer-toolbar" data-testid="viewer-toolbar">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        <span data-testid="page-indicator">
          {page} / {total}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= total}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
        <select
          className="doc-switcher"
          data-testid="doc-switcher"
          aria-label="Document"
          value={currentSource}
          onChange={(e) => {
            const range = ranges.find((r) => r.sourceId === e.target.value);
            if (range) onPageChange(range.from);
          }}
        >
          {ranges.map((r) => (
            <option key={r.sourceId} value={r.sourceId}>
              {r.label} ({r.range})
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" data-testid="viewer-error">
          {error}
        </p>
      )}
      <div className="page-scroll" ref={containerRef} data-testid="page-scroll">
        <div className="page-stack">
          <canvas ref={canvasRef} data-testid="page-canvas" />
          {boxes.map((b, i) => (
            <div
              key={i}
              className="hl"
              data-testid="hl"
              style={{
                left: b.x * scale,
                top: b.y * scale,
                width: b.w * scale,
                height: b.h * scale,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
