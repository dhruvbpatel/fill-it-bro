import type { Citation, DocumentSet, DocumentSource } from '@fib/contracts';

/**
 * Display name for a source. Attachments are prefixed with the email they
 * arrived in: "sample.msg › attachment 1".
 */
export function sourceDisplayName(
  source: DocumentSource,
  sources: readonly DocumentSource[],
): string {
  if (source.kind !== 'attachment') {
    return source.name;
  }
  const parent = sources.find((s) => s.kind === 'emailBody');
  return parent ? `${parent.name} › ${source.name}` : source.name;
}

/** "from <source name>, page N" for a field's citation (ticket 23). */
export function citationSourceLabel(citation: Citation, set: DocumentSet): string {
  const source = set.sources.find((s) => s.sourceId === citation.sourceId);
  const name = source ? sourceDisplayName(source, set.sources) : citation.sourceId;
  return `from ${name}, page ${citation.sourcePage}`;
}
