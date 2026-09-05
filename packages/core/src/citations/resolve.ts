import type {
  Box,
  Citation,
  CitationRef,
  DocumentSet,
  ExtractedField,
  ExtractionResult,
  ResolvedField,
  TextItem,
} from '@fib/contracts';
import { normalise, tokenSetRatio } from '../text/similarity.js';

/** Same shape as `@fib/ingest`'s `findPhrase` return value; core must not depend on ingest. */
export interface PhraseMatch {
  mergedPage: number;
  itemIds: string[];
}

/** Same shape as `@fib/ingest`'s `findPhrase`; passed in so core stays ingest-free. */
export type FindPhrase = (set: DocumentSet, phrase: string) => PhraseMatch[];

const UNVERIFIED_CONFIDENCE_CAP = 0.4;

export function resolve(
  set: DocumentSet,
  result: ExtractionResult,
  findPhrase: FindPhrase,
): ResolvedField[] {
  const fields = result.fields.map((field) => resolveField(set, field, findPhrase));
  const cells = result.groups.flatMap((group) =>
    group.rows.flatMap((row) => row.cells.map((cell) => resolveField(set, cell, findPhrase))),
  );
  return [...fields, ...cells];
}

function resolveField(
  set: DocumentSet,
  field: ExtractedField,
  findPhrase: FindPhrase,
): ResolvedField {
  if (field.status === 'notFound') {
    return {
      fieldId: field.fieldId,
      value: field.value,
      valueType: field.valueType,
      status: field.status,
      confidence: field.confidence,
      sourceId: field.sourceId,
      reason: field.reason,
      citations: [],
    };
  }

  const citations: Citation[] = [];
  let droppedAny = false;
  for (const ref of field.citations) {
    const citation = resolveCitation(set, ref, findPhrase);
    if (citation) citations.push(citation);
    else droppedAny = true;
  }

  return {
    fieldId: field.fieldId,
    value: field.value,
    valueType: field.valueType,
    status: droppedAny ? 'unverifiedCitation' : field.status,
    confidence: droppedAny
      ? Math.min(field.confidence, UNVERIFIED_CONFIDENCE_CAP)
      : field.confidence,
    sourceId: field.sourceId,
    reason: field.reason,
    citations,
  };
}

function resolveCitation(
  set: DocumentSet,
  ref: CitationRef,
  findPhrase: FindPhrase,
): Citation | null {
  const byIds = resolveByItemIds(set, ref.itemIds, ref.quote);
  if (byIds) return toCitation(set, byIds.mergedPage, byIds.boxes, ref.quote);

  const hits = findPhrase(set, ref.quote);
  if (hits.length > 0) {
    const hit = hits[0];
    return toCitation(
      set,
      hit.mergedPage,
      boxesForItemIds(set, hit.mergedPage, hit.itemIds),
      ref.quote,
    );
  }

  return null;
}

function resolveByItemIds(
  set: DocumentSet,
  itemIds: string[],
  quote: string,
): { mergedPage: number; boxes: Box[] } | null {
  if (itemIds.length === 0) return null;

  let mergedPage: number | undefined;
  const items: TextItem[] = [];
  for (const itemId of itemIds) {
    const hit = findItem(set, itemId);
    if (!hit) return null;
    if (mergedPage === undefined) mergedPage = hit.mergedPage;
    else if (mergedPage !== hit.mergedPage) return null;
    items.push(hit.item);
  }

  if (!quoteMatches(quote, items.map((item) => item.text).join(' '))) return null;
  return { mergedPage: mergedPage as number, boxes: items.map(toBox) };
}

function quoteMatches(quote: string, joinedText: string): boolean {
  const normalisedQuote = normalise(quote);
  if (normalisedQuote === '') return false;
  const normalisedJoined = normalise(joinedText);
  if (normalisedJoined.includes(normalisedQuote)) return true;
  return tokenSetRatio(normalisedQuote, normalisedJoined) >= 0.9;
}

function findItem(
  set: DocumentSet,
  itemId: string,
): { mergedPage: number; item: TextItem } | undefined {
  for (const page of set.pages) {
    const item = page.items.find((candidate) => candidate.id === itemId);
    if (item) return { mergedPage: page.mergedPage, item };
  }
  return undefined;
}

function boxesForItemIds(set: DocumentSet, mergedPage: number, itemIds: string[]): Box[] {
  const page = set.pages.find((candidate) => candidate.mergedPage === mergedPage);
  if (!page) return [];
  const byId = new Map(page.items.map((item) => [item.id, item]));
  return itemIds
    .map((id) => byId.get(id))
    .filter((item): item is TextItem => item !== undefined)
    .map(toBox);
}

function toBox(item: TextItem): Box {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function toCitation(set: DocumentSet, mergedPage: number, boxes: Box[], quote: string): Citation {
  const manifestEntry = set.manifest.find((entry) => entry.mergedPage === mergedPage);
  return {
    mergedPage,
    boxes,
    quote,
    sourceId: manifestEntry?.sourceId ?? '',
    sourcePage: manifestEntry?.sourcePage ?? 0,
  };
}
