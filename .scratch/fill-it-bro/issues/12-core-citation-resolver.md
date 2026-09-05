# 12: Core: citation resolver

**What to build:** Turning the LLM's item-id citations into verified page + bounding-box highlights, with a deterministic fallback when the ids are wrong and an explicit "unverified" status when nothing matches.

**Blocked by:** 03 (Ingest: PDF → DocumentSet)

**Status:** done

## Read first
- PLAN.md §4 "Client-side citation resolution".

## Do exactly this
- `packages/core/src/citations/resolve.ts`: `resolve(set: DocumentSet, result: ExtractionResult, findPhrase: FindPhrase): ResolvedField[]` where `FindPhrase` is the function type from `@fib/ingest` (core must not import ingest; pass it in).
- Per citation ref: look up each `itemId` in `set.pages[].items`; all found and on one page → boxes = those items' rects; `normalise(quote)` must be a substring of `normalise(joinedText)` or token-set ratio ≥ 0.9 (implement `tokenSetRatio` in `packages/core/src/text/similarity.ts`, no external dep). Else call `findPhrase(set, quote)`; first hit wins. Else: citation dropped, field `status = 'unverifiedCitation'`, `confidence = Math.min(confidence, 0.4)`.
- Attach `sourceId`/`sourcePage` from `set.manifest` by `mergedPage`.
- Fields with `status: notFound` pass through unchanged with empty citations. Groups: resolve each cell the same way.
- `normalise`: lowercase, collapse whitespace, strip punctuation except `.`, `,`, `-`, `/`.

## Acceptance criteria
- [x] Good ids + matching quote → boxes equal item rects, status unchanged.
- [x] Bad ids + findable quote → boxes from `findPhrase`, status unchanged.
- [x] Bad ids + unfindable quote → no boxes, `unverifiedCitation`, confidence ≤ 0.4.
- [x] `sourcePage` correct for a manifest where mergedPage 3 = att-1/2.
