import type { DocumentSource, ManifestEntry } from '@fib/contracts';
import { PDFDocument } from 'pdf-lib';

export interface MergePart {
  source: DocumentSource;
  pdf: Uint8Array;
}

export interface MergeResult {
  mergedPdf: Uint8Array;
  manifest: ManifestEntry[];
  sources: DocumentSource[];
}

export async function mergeSources(parts: MergePart[]): Promise<MergeResult> {
  const merged = await PDFDocument.create();
  const manifest: ManifestEntry[] = [];
  let mergedPage = 0;
  for (const part of parts) {
    const doc = await PDFDocument.load(part.pdf);
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page, sourcePageIndex) => {
      merged.addPage(page);
      mergedPage += 1;
      manifest.push({
        mergedPage,
        sourceId: part.source.sourceId,
        sourcePage: sourcePageIndex + 1,
      });
    });
  }
  return {
    mergedPdf: await merged.save(),
    manifest,
    sources: parts.map((part) => part.source),
  };
}
