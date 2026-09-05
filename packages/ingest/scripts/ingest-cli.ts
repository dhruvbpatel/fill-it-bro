import { defaultDeps, ingest } from '../src/index.js';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('usage: tsx scripts/ingest-cli.ts <pdf> > documentSet.json');
  process.exit(1);
}

const ingested = await ingest([pdfPath], defaultDeps);

// Only the contract shape (text + boxes) may leave the client: drop the merged PDF bytes.
const documentSet = {
  setId: ingested.setId,
  sources: ingested.sources,
  manifest: ingested.manifest,
  pages: ingested.pages,
  ...(ingested.skipped && ingested.skipped.length > 0 ? { skipped: ingested.skipped } : {}),
};
process.stdout.write(JSON.stringify(documentSet, null, 2));
