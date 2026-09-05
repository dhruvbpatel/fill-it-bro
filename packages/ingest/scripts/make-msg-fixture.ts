import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiteParse } from '@llamaindex/liteparse';
import { Attachment, Email } from '@tutao/oxmsg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const EPOCH = new Date(0);

// A 2-page PDF attachment; page 2 carries the phrase resolved via the text layer
// (mergedPage 3 once merged after the 1-page email body).
async function buildTermsPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page1 = pdf.addPage([612, 792]);
  page1.drawText('Term Sheet: Goldman Sachs Incorporated', {
    x: 72,
    y: 700,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  const page2 = pdf.addPage([612, 792]);
  page2.drawText('Settlement 2026-09-30', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  return pdf.save();
}

// A PNG containing rendered (not embedded-text) "Fee 12,500", built by rasterizing a
// one-page PDF with LiteParse's screenshot renderer, so parsePdf must OCR it back out.
async function buildFeePng(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([300, 100]);
  page.drawText('Fee 12,500', { x: 20, y: 50, size: 20, font, color: rgb(0, 0, 0) });
  const bytes = await pdf.save();
  const renderer = new LiteParse({ quiet: true });
  const [shot] = await renderer.screenshot(bytes);
  if (!shot) throw new Error('LiteParse.screenshot produced no pages');
  return shot.imageBuffer;
}

export async function buildSampleMsg(): Promise<Uint8Array> {
  const [termsPdf, feePng] = await Promise.all([buildTermsPdf(), buildFeePng()]);

  const email = new Email();
  email.bodyText('Please onboard Goldman Sachs Incorporated');
  email.attach(new Attachment(termsPdf, 'terms.pdf'));
  email.attach(new Attachment(feePng, 'fee.png'));
  return email.msg();
}

async function writeSampleMsg(dir: string): Promise<string> {
  const bytes = await buildSampleMsg();
  const file = path.join(dir, 'sample.msg');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

async function main(): Promise<void> {
  const dir = path.resolve(import.meta.dirname, '../fixtures');
  const file = await writeSampleMsg(dir);
  console.log(`wrote ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
