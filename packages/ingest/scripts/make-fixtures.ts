import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const EPOCH = new Date(0);

export async function buildSimplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);
  pdf.setProducer('fill-it-bro fixtures');
  pdf.setCreator('fill-it-bro fixtures');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page1 = pdf.addPage([612, 792]);
  page1.drawText('Issuer: Goldman Sachs Incorporated', {
    x: 72,
    y: 700,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  const page2 = pdf.addPage([612, 792]);
  page2.drawText('Amount: 1,250,000 USD', {
    x: 72,
    y: 700,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  return pdf.save();
}

export async function writeSimplePdf(dir: string): Promise<string> {
  const bytes = await buildSimplePdf();
  const file = path.join(dir, 'simple.pdf');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

async function main(): Promise<void> {
  const dir = path.resolve(import.meta.dirname, '../fixtures');
  const file = await writeSimplePdf(dir);
  console.log(`wrote ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
