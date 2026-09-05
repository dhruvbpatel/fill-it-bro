import { PDFDocument } from 'pdf-lib';

export async function imageToPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const image = mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return pdf.save();
}
