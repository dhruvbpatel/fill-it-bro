import type { DocumentSource, ManifestEntry } from '@fib/contracts';
import { sourceDisplayName } from '../state/sourceLabel.js';

export interface SourceRange {
  sourceId: string;
  /** Display label (attachment names are prefixed with their email). */
  label: string;
  /** "1" or "2–3" — the merged pages this source occupies. */
  range: string;
  from: number;
  to: number;
}

/** Group manifest pages by source, in first-appearance (merged page) order. */
export function sourceRanges(
  manifest: readonly ManifestEntry[],
  sources: readonly DocumentSource[],
): SourceRange[] {
  const groups = new Map<string, { from: number; to: number }>();
  for (const entry of [...manifest].sort((a, b) => a.mergedPage - b.mergedPage)) {
    const group = groups.get(entry.sourceId);
    if (group) {
      group.to = Math.max(group.to, entry.mergedPage);
    } else {
      groups.set(entry.sourceId, { from: entry.mergedPage, to: entry.mergedPage });
    }
  }
  return [...groups.entries()].map(([sourceId, { from, to }]) => {
    const source = sources.find((s) => s.sourceId === sourceId);
    return {
      sourceId,
      from,
      to,
      label: source ? sourceDisplayName(source, sources) : sourceId,
      range: from === to ? `${from}` : `${from}–${to}`,
    };
  });
}
