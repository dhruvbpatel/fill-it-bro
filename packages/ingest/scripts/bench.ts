import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { LiteParse } from '@llamaindex/liteparse';
import initWasm, { LiteParse as LiteParseWasm } from '@llamaindex/liteparse-wasm';

const PAGES = 10;
const DPI = 150;
const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/scanned-10p.pdf');

async function generateScannedFixture(): Promise<Uint8Array> {
  const textPdf = await PDFDocument.create();
  const font = await textPdf.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= PAGES; p++) {
    const page = textPdf.addPage([612, 792]);
    page.drawText(`Benchmark document page ${p}`, {
      x: 72,
      y: 700,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`Reference party ${p}: Goldman Sachs Incorporated`, {
      x: 72,
      y: 660,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`Amount: ${(p * 1250000).toLocaleString('en-US')} USD`, {
      x: 72,
      y: 620,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const textBytes = await textPdf.save();

  const renderer = new LiteParse({ quiet: true });
  const shots = await renderer.screenshot(new Uint8Array(textBytes));

  const scanned = await PDFDocument.create();
  for (const shot of shots) {
    const png = await scanned.embedPng(shot.imageBuffer);
    const width = (shot.width * 72) / DPI;
    const height = (shot.height * 72) / DPI;
    const page = scanned.addPage([width, height]);
    page.drawImage(png, { x: 0, y: 0, width, height });
  }
  return scanned.save();
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function countItems(result: { pages: Array<{ textItems: unknown[] }> }): number {
  return result.pages.reduce((sum, page) => sum + page.textItems.length, 0);
}

async function main(): Promise<void> {
  let bytes: Uint8Array;
  if (existsSync(FIXTURE)) {
    bytes = new Uint8Array(await readFile(FIXTURE));
    console.log(`using existing fixture ${FIXTURE}`);
  } else {
    bytes = await generateScannedFixture();
    await writeFile(FIXTURE, bytes);
    console.log(`generated fixture ${FIXTURE} (${(bytes.length / 1024).toFixed(0)} KiB)`);
  }

  const runs = 3;

  const native = new LiteParse({ ocrEnabled: true, quiet: true });
  const nativeWarm = await timed(() => native.parse(bytes));
  const nativeRuns: number[] = [];
  let nativeItems = 0;
  for (let i = 0; i < runs; i++) {
    const { ms, value } = await timed(() => native.parse(bytes));
    nativeRuns.push(ms);
    nativeItems = countItems(value);
  }
  const firstNativeItem = nativeWarm.value.pages[0]?.textItems[0]?.text ?? '(none)';

  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm');
  await initWasm({ module_or_path: new Uint8Array(await readFile(wasmPath)) });
  const wasm = new LiteParseWasm({ ocrEnabled: false });
  const wasmWarm = await timed(() => wasm.parse(bytes));
  const wasmRuns: number[] = [];
  let wasmItems = 0;
  for (let i = 0; i < runs; i++) {
    const { ms, value } = await timed(() => wasm.parse(bytes));
    wasmRuns.push(ms);
    wasmItems = countItems(value);
  }

  const table = [
    ['build', 'ocr', `warm-up (ms)`, `runs (ms)`, `median (ms)`, 'text items found'],
    [
      'native (@llamaindex/liteparse)',
      'enabled (built-in Tesseract)',
      nativeWarm.ms.toFixed(0),
      nativeRuns.map((ms) => ms.toFixed(0)).join(', '),
      median(nativeRuns).toFixed(0),
      String(nativeItems),
    ],
    [
      'wasm (@llamaindex/liteparse-wasm)',
      'unavailable in this build',
      wasmWarm.ms.toFixed(0),
      wasmRuns.map((ms) => ms.toFixed(0)).join(', '),
      median(wasmRuns).toFixed(0),
      String(wasmItems),
    ],
  ];
  console.log();
  for (const row of table) {
    console.log(`| ${row.join(' | ')} |`);
  }
  console.log(`\nnative OCR sample from page 1: "${firstNativeItem}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
