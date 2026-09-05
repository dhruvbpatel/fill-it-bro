import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Box, DocumentSource, ManifestEntry } from '@fib/contracts';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfViewer } from './PdfViewer.js';

const FIXTURE_PDF = path.resolve(import.meta.dirname, '../../../ingest/fixtures/simple.pdf');

const sources: DocumentSource[] = [
  { sourceId: 'body', kind: 'emailBody', name: 'sample.msg', mime: 'message/rfc822' },
  { sourceId: 'att-1', kind: 'attachment', name: 'attachment 1', mime: 'application/pdf' },
  { sourceId: 'att-2', kind: 'attachment', name: 'attachment 2', mime: 'image/png' },
];

// Body (page 1), attachment 1 (pages 2–3), attachment 2 (page 4).
const manifest4: ManifestEntry[] = [
  { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
  { mergedPage: 2, sourceId: 'att-1', sourcePage: 1 },
  { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
  { mergedPage: 4, sourceId: 'att-2', sourcePage: 1 },
];

const uploadManifest: ManifestEntry[] = [{ mergedPage: 1, sourceId: 'upload-1', sourcePage: 1 }];
const uploadSources: DocumentSource[] = [
  { sourceId: 'upload-1', kind: 'upload', name: 'simple.pdf', mime: 'application/pdf' },
];

beforeEach(() => {
  // The viewer sizes itself to its container; jsdom reports 0 everywhere.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PdfViewer highlight geometry', () => {
  it(
    'places a highlight at x*scale, y*scale (±1 px) for a known fixture item at 600 px width',
    { timeout: 30_000 },
    async () => {
      const pdf = new Uint8Array(readFileSync(FIXTURE_PDF));
      const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
      const pdfPage = await doc.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const text = await pdfPage.getTextContent();
      const item = text.items.find((i) => 'str' in i && i.str.includes('Goldman Sachs'));
      if (!item || !('transform' in item)) throw new Error('known item not found in fixture');
      // LiteParse boxes are top-left origin in points; pdfjs text transforms
      // are baseline, bottom-left origin — convert the known item accordingly.
      const [, , , , e, f] = item.transform;
      const box: Box = {
        x: e,
        y: viewport.height - (f + item.height),
        w: item.width,
        h: item.height,
      };
      const scale = 600 / viewport.width;

      render(
        <PdfViewer
          pdf={pdf}
          page={1}
          boxes={[box]}
          manifest={uploadManifest}
          sources={uploadSources}
          onPageChange={() => {}}
        />,
      );
      const highlight = await screen.findByTestId('hl', {}, { timeout: 15_000 });
      expect(Math.abs(parseFloat(highlight.style.left) - box.x * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(parseFloat(highlight.style.top) - box.y * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(parseFloat(highlight.style.width) - box.w * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(parseFloat(highlight.style.height) - box.h * scale)).toBeLessThanOrEqual(1);
    },
  );
});

describe('PdfViewer toolbar', () => {
  it('lists every source with its page range; choosing one jumps to its first page', async () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        pdf={new Uint8Array()}
        page={1}
        boxes={[]}
        manifest={manifest4}
        sources={sources}
        onPageChange={onPageChange}
      />,
    );
    await screen.findByTestId('viewer-error');
    expect(screen.getByTestId('page-indicator').textContent).toBe('1 / 4');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'sample.msg (1)',
      'sample.msg › attachment 1 (2–3)',
      'sample.msg › attachment 2 (4)',
    ]);
    fireEvent.change(screen.getByTestId('doc-switcher'), { target: { value: 'att-1' } });
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('steps pages with prev/next and disables at the edges', async () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewer
        pdf={new Uint8Array()}
        page={3}
        boxes={[]}
        manifest={manifest4}
        sources={sources}
        onPageChange={onPageChange}
      />,
    );
    await screen.findByTestId('viewer-error');
    expect(screen.getByTestId('page-indicator').textContent).toBe('3 / 4');
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    expect(screen.getByTestId('doc-switcher')).not.toBeNull();
  });
});
