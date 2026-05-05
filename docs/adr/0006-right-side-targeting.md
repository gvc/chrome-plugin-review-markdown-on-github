# ADR-006: Always target `data-diff-side="right"` for split diffs

**Status:** Accepted
**Date:** 2026-05-05

## Context

GitHub's split (side-by-side) diff renders both the base and head versions in the same `<table>`. Each row has cells for both sides; both can carry a `data-line-number` attribute, and both can have the same number when the line is unchanged context.

Naive selector:

```css
td.new-diff-line-number[data-line-number="431"]
```

…matches both the left (base) and right (head) cells. `querySelector` returns the first one. In split-diff mode that's the base side. Comments must go on the head side.

This produced two distinct symptoms:

1. **Scrape misalignment.** `line-mapper.scrapeRawFromSourceDiff` could pick base-side line numbers and pair them with head-side text, or skip rows where the right-side cell didn't match the predicate. Line maps came out shifted.
2. **Comment trigger on the wrong side.** `native-comment-trigger.findDiffRow` could return the base-side row, and the resulting comment trigger landed on a line that doesn't match the user's intent — or simply failed because the base side has no add-comment hover button.

## Decision

Every selector that reaches into a diff row qualifies on `data-diff-side="right"` first, with fallbacks for unified diffs and legacy DOM:

```typescript
// Prefer head side
td[data-diff-side="right"][data-line-number="N"]

// Unified diff fallback (no data-diff-side attribute at all)
td.new-diff-line-number[data-line-number="N"]:not([data-diff-side="left"])

// Legacy GitHub DOM fallback
td.blob-num-addition[data-line-number="N"], td.blob-num-context[data-line-number="N"]
```

Applies to:
- `line-mapper.ts:scrapeRawFromSourceDiff` — when picking the line-number cell.
- `native-comment-trigger.ts:findDiffRow` — when locating the row to comment on.
- `native-comment-trigger.ts:triggerAddCommentButton` — when picking the hover target and the click target.

## Consequences

**Wins**
- Eliminates a whole class of off-by-the-other-side bugs in split diff.
- Selectors are explicit about intent. New code reading them sees "right side, head, head, head" and gets it right.
- Unified-diff users still work via the `:not([data-diff-side="left"])` fallback (unified DOM has no `data-diff-side` attribute, so neither side is excluded).

**Costs**
- Selectors get longer and less readable.
- One more thing to remember when adding new diff-row code.
- If GitHub ever renames or removes `data-diff-side`, all of these selectors fail at once. Rare and very visible — better than silent off-by-side bugs.

## Alternatives considered

- **Filter in JavaScript after `querySelectorAll`.** Rejected: more code, easier to forget to filter, no semantic clarity at the call site.
- **Trust the legacy `td.new-diff-line-number:not(.right-side-diff-cell)` filter.** Rejected: that class controls a styling concern, not a side concern; relying on it is incidental coupling that broke when GitHub changed how cells were classed.
