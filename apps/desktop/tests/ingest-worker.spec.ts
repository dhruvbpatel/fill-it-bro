import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../dist/main/index.js');
const sampleMsg = resolve(__dirname, '../../../packages/ingest/fixtures/sample.msg');
const simplePdf = resolve(__dirname, '../../../packages/ingest/fixtures/simple.pdf');

interface ProgressLike {
  stage: string;
  pct: number;
}

interface IngestOutcome {
  pageCount: number;
  manifest: Array<{ mergedPage: number; sourceId: string; sourcePage: number }>;
  progress: ProgressLike[];
  pdfMagic: string;
  fibLeftovers: string[];
  reusedPageCount: number;
}

test.describe('desktop ingest worker', () => {
  let app: ElectronApplication;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'fib-desktop-ingest-'));
    app = await electron.launch({
      args: [mainPath, '--dealId=1', '--formId=fixtureDeal', `--user-data-dir=${userDataDir}`],
    });
  });

  test.afterAll(async () => {
    await app.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  test('ingests sample.msg through the utility process', async () => {
    // OCR of the PNG attachment via LiteParse is slow, especially on CI cold starts.
    test.setTimeout(300_000);

    const result = await app.evaluate(
      async (_electron, payload): Promise<IngestOutcome> => {
        const { readdirSync } = process.getBuiltinModule('node:fs');
        const { createRequire } = process.getBuiltinModule('node:module');
        const mod = createRequire(payload.entryPath)(payload.entryPath) as {
          ingestFiles: (
            paths: string[],
            onProgress: (p: ProgressLike) => void,
          ) => Promise<{
            documentSet: {
              pages: unknown[];
              manifest: Array<{ mergedPage: number; sourceId: string; sourcePage: number }>;
            };
            mergedPdf: ArrayBuffer;
          }>;
        };

        const progress: ProgressLike[] = [];
        const before = new Set(readdirSync(payload.tmpDir));
        const { documentSet, mergedPdf } = await mod.ingestFiles([payload.sampleMsg], (p) =>
          progress.push(p),
        );
        const fibLeftovers = readdirSync(payload.tmpDir).filter(
          (entry) => entry.startsWith('fib-') && !before.has(entry),
        );

        // Second call must succeed on the reused worker process.
        const second = await mod.ingestFiles([payload.simplePdf], () => {});

        return {
          pageCount: documentSet.pages.length,
          manifest: documentSet.manifest,
          progress,
          pdfMagic: Buffer.from(mergedPdf.slice(0, 5)).toString('latin1'),
          fibLeftovers,
          reusedPageCount: second.documentSet.pages.length,
        };
      },
      { entryPath: mainPath, sampleMsg, simplePdf, tmpDir: tmpdir() },
    );

    expect(result.pageCount).toBe(4);
    expect(result.manifest).toEqual([
      { mergedPage: 1, sourceId: 'body', sourcePage: 1 },
      { mergedPage: 2, sourceId: 'att-1', sourcePage: 1 },
      { mergedPage: 3, sourceId: 'att-1', sourcePage: 2 },
      { mergedPage: 4, sourceId: 'att-2', sourcePage: 1 },
    ]);

    const stages = result.progress.map((p) => p.stage);
    const expectedOrder = ['split', 'renderBody', 'merge', 'parse'];
    for (const stage of expectedOrder) {
      expect(stages, `missing progress stage '${stage}'`).toContain(stage);
    }
    const firsts = expectedOrder.map((stage) => stages.indexOf(stage));
    expect(
      firsts.every((v, i) => i === 0 || v > firsts[i - 1]!),
      `progress stages out of order: ${stages.join(', ')}`,
    ).toBe(true);
    const pcts = result.progress.map((p) => p.pct);
    expect(pcts.every((v, i) => i === 0 || v > pcts[i - 1]!)).toBe(true);

    expect(result.pdfMagic).toBe('%PDF-');
    expect(result.fibLeftovers).toEqual([]);
    expect(result.reusedPageCount).toBe(2);
  });
});
