import type { DocumentSet } from '@fib/contracts';

export interface PhraseMatch {
  mergedPage: number;
  itemIds: string[];
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findPhrase(set: DocumentSet, phrase: string): PhraseMatch[] {
  const needle = normalise(phrase);
  if (needle === '') return [];
  const matches: PhraseMatch[] = [];
  for (const page of set.pages) {
    const spans: Array<{ start: number; end: number; id: string }> = [];
    let joined = '';
    for (const item of page.items) {
      const text = normalise(item.text);
      if (text === '') continue;
      if (joined.length > 0) joined += ' ';
      spans.push({ start: joined.length, end: joined.length + text.length, id: item.id });
      joined += text;
    }
    let from = 0;
    for (;;) {
      const at = joined.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      matches.push({
        mergedPage: page.mergedPage,
        itemIds: spans.filter((s) => s.start < end && s.end > at).map((s) => s.id),
      });
      from = at + 1;
    }
  }
  return matches;
}
