# Spec: Resilience Fixes for Comment Triggering & Rich/Source Diff Toggle

## Problem

Extension works intermittently. Two main failure modes:

1. **Toggle flakiness**: User must toggle rich <-> source diff multiple times before commenting works
2. **Comment trigger failure**: `Could not open comment form for line N. GitHub's UI may have changed.`

## Root Cause Analysis

### Bug 1: Race between toggle observer and scraping

**File**: `src/content/index.ts` (lines 56-60, 86-131)

When page loads with rich diff active, no scraping happens. The code says:
```ts
if (isRichDiffActive(container)) {
  // Rich diff already active — no source table in DOM yet, nothing to scrape.
}
```

Then the toggle observer fires on switch to source, scrapes, and on switch back to rich, calls `processFile()`. But there are multiple race conditions:

- **`observeRichDiffToggle` fires on *any* mutation** (childList, subtree, attributes on class/hidden/style/aria-hidden). GitHub's React DOM mutates heavily during toggle transitions. The `isRichDiffActive()` check bounces true/false rapidly during a single toggle, causing the callback to fire multiple times or at the wrong moment.
- **`lastRichDiffState` guard is insufficient**: It prevents consecutive same-state callbacks but doesn't prevent rapid true-false-true sequences during a single transition. A mutation mid-transition can set `lastRichDiffState = false`, then the real arrival of the article fires `active = true` again, but `scrapeRawFromSourceDiff()` returns null because the table was already replaced by the article.
- **Scrape on source->rich transition returns null**: When toggling to rich diff, the callback at line 95 tries `scrapeRawFromSourceDiff(container, filePath)` but the table may already be gone from DOM (React unmounted it). If the init scrape also missed (rich diff was active on load), we have no raw markdown.

### Bug 2: `triggerAddCommentButton` strategies don't match current GitHub DOM

**File**: `src/content/native-comment-trigger.ts` (lines 75-139)

After analyzing the actual GitHub DOM from `review-after-load.html`:

- **Strategy 1** (`.js-add-line-comment`): Legacy selector, not present in current GitHub DOM.
- **Strategy 2** (`td.right-side-diff-cell` click): Clicks the code cell, expects `div[data-inline-markers][aria-hidden="false"]` to appear. But in the actual DOM, inline markers are rendered *inside* the `<td>` already with `aria-hidden="true"` and toggled by GitHub's React code. A raw `click()` on the `<td>` doesn't trigger the React event handler that opens the inline comment dialog. GitHub listens for clicks on specific child elements, not the `<td>` itself.
- **Strategy 3** (hover to reveal button): Dispatches synthetic `mouseenter`/`mouseover`. GitHub's React event handlers use React's synthetic event system, which doesn't respond to native `MouseEvent` dispatched via `dispatchEvent()`.
- **Strategy 4** (click line number cell): Same issue — `click()` on the `<td>` doesn't trigger GitHub's React handler.

The actual DOM from the HTML examples shows:
- Line numbers are in `td.new-diff-line-number[data-line-number]` cells
- Comment buttons appear on hover as small `+` icons but are rendered by React's event system
- The `data-line-anchor` attribute on code cells (e.g., `data-line-anchor="diff-{hash}R431"`) links them to specific lines

### Bug 3: `findDiffRow` may match the wrong side

**File**: `src/content/native-comment-trigger.ts` (lines 53-73)

`findDiffRow` selects `td.new-diff-line-number[data-line-number="N"]` but in split diff view, the same line number appears on both left and right sides. The selector picks the first match, which may be the left (base) side — comments must go on the right (head) side. From the HTML:

```html
<td class="... new-diff-line-number left-side ..." data-diff-side="left" data-line-number="431">431</td>
...
<td class="... new-diff-line-number left-side ..." data-diff-side="right" data-line-number="431">431</td>
```

Both match `td.new-diff-line-number[data-line-number="431"]`. The correct cell is `data-diff-side="right"`.

### Bug 4: Scraped content from only-additions diffs

**File**: `src/content/line-mapper.ts` (lines 40-55)

The scraper looks for `td.new-diff-line-number[data-line-number]:not(.right-side-diff-cell)` for line numbers and `td.right-side-diff-cell` for code content. But in the actual DOM, both the left line number cell and right line number cell have class `new-diff-line-number`. Without filtering by `data-diff-side="right"`, the scraper may pick up base-side line numbers and misalign content.

## Proposed Changes

### Fix 1: Debounce toggle observer and add transition-aware scraping

**File**: `src/content/index.ts`

**Change**: Replace the simple `lastRichDiffState` guard with a debounced, transition-aware handler.

```
- On toggle callback, wait 300ms of stable state before acting
- If state changes again within 300ms, reset the timer
- On transition to source diff: scrape immediately (table is fresh)
- On transition to rich diff: verify raw markdown exists in cache, 
  if not, programmatically toggle to source, scrape, toggle back to rich
```

**Details**:
- Add a `settleTimeout` variable alongside `lastRichDiffState`
- In the observer callback, clear any pending `settleTimeout`, then set a new one at 300ms
- Inside the settled callback, check `isRichDiffActive()` again (not the argument) for ground truth
- For the "rich diff active on load" case: proactively switch to source, scrape, switch back before user interaction. This eliminates the "toggle once to prime the scrape" problem.

### Fix 2: Use GitHub's keyboard shortcut to open comment form

**File**: `src/content/native-comment-trigger.ts`

**Change**: Instead of trying to click DOM elements (which React ignores), use GitHub's built-in keyboard interaction.

**Approach A — Click the line number `<button>` inside the cell**:
The actual DOM shows line numbers are sometimes rendered as buttons or have click handlers. Inspect the real DOM more carefully for the exact clickable element.

**Approach B — Focus + keyboard event**:
GitHub supports keyboard navigation in diffs. After focusing a cell, pressing `Enter` or a specific key opens the comment dialog.

**Approach C — Use the `data-line-anchor` attribute**:
Navigate to `#diff-{hash}R{lineNumber}` which GitHub interprets as a line anchor, potentially opening the comment UI.

**Recommended approach**: Rewrite `triggerAddCommentButton` to:

1. Find the right-side diff cell for the target line (using `data-diff-side="right"`)
2. Look for any `<button>` element within or adjacent to the row that GitHub renders for adding comments
3. If no button found, try clicking the line number cell on the right side — GitHub's React handler *does* listen on the right-side line number for opening inline comment markers
4. Wait longer (up to 3s instead of current 200-250ms) for React to render the comment UI
5. Check for the comment textarea in the inline markers div, not just in the row

**Specific DOM-informed changes**:
```ts
// Target the RIGHT side specifically
const rightNumCell = row.querySelector<HTMLElement>(
  'td[data-diff-side="right"][data-line-number]'
);

// After click, look for textarea in broader scope:
// - The current row
// - Next sibling rows (comment form may be injected as new row)
// - Any div[data-inline-markers] that becomes visible
```

### Fix 3: Fix `findDiffRow` to target the right (head) side

**File**: `src/content/native-comment-trigger.ts`

**Change**: Qualify all selectors with `data-diff-side="right"`.

```ts
function findDiffRow(table: HTMLElement, lineNumber: number): HTMLTableRowElement | null {
  // Always target the right (head) side for comments
  const rightCell = table.querySelector<HTMLTableCellElement>(
    `td[data-diff-side="right"][data-line-number="${lineNumber}"]`
  );
  if (rightCell) return rightCell.closest('tr');

  // Fallback for unified diff (no data-diff-side)
  const unifiedCell = table.querySelector<HTMLTableCellElement>(
    `td.new-diff-line-number[data-line-number="${lineNumber}"]:not([data-diff-side="left"])`
  );
  if (unifiedCell) return unifiedCell.closest('tr');

  // Legacy fallback
  const oldCell = table.querySelector<HTMLTableCellElement>(
    `td.blob-num-addition[data-line-number="${lineNumber}"], 
     td.blob-num-context[data-line-number="${lineNumber}"]`
  );
  if (oldCell) return oldCell.closest('tr');

  return null;
}
```

### Fix 4: Fix line-mapper scraping to use right-side data

**File**: `src/content/line-mapper.ts`

**Change**: When scraping, explicitly select `data-diff-side="right"` cells for line numbers.

```ts
// Instead of:
const newNumCell = row.querySelector<HTMLTableCellElement>(
  'td.new-diff-line-number[data-line-number]:not(.right-side-diff-cell)'
);

// Use:
const newNumCell = row.querySelector<HTMLTableCellElement>(
  'td[data-diff-side="right"][data-line-number]:not(.right-side-diff-cell)'
);
```

This ensures we only scrape head-side line numbers, avoiding duplication from the base side.

### Fix 5: Auto-prime scrape on initial load when rich diff is active

**File**: `src/content/index.ts`

**Change**: When a markdown file loads with rich diff active, proactively toggle to source diff, scrape, then toggle back.

```ts
if (isRichDiffActive(container)) {
  // Rich diff active on load — we need source data but have no table.
  // Programmatically switch to source, scrape, switch back.
  const switched = await switchToSourceDiff(container);
  if (switched) {
    scrapeRawFromSourceDiff(container, filePath);
    scrapeExistingComments(container, filePath);
    await switchToRichDiff(container);
    await processFile(container, filePath);
  }
}
```

This eliminates the requirement for users to manually toggle before commenting works.

### Fix 6: Retry logic for comment triggering

**File**: `src/content/native-comment-trigger.ts`

**Change**: Add retry with backoff for `triggerAddCommentButton`, since GitHub's React may need time to hydrate.

```ts
async function triggerNativeCommentOnLine(...): Promise<TriggerResult> {
  // ... find row ...
  
  // Try up to 3 times with increasing delays
  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await triggerAddCommentButton(targetRow);
    if (opened) {
      // success — fill textarea
      break;
    }
    if (attempt < 2) {
      await delay(500 * (attempt + 1)); // 500ms, 1000ms
    }
  }
}
```

### Fix 7: Expand `waitForCommentTextarea` search scope

**File**: `src/content/native-comment-trigger.ts`

**Change**: After triggering the comment button, the textarea may appear:
- Inside the same row (inline markers)
- In a new row injected below
- In a portal/overlay div outside the table

Expand the mutation observer scope to watch the entire diff container, not just the table:

```ts
function waitForCommentTextarea(row, timeoutMs): Promise<...> {
  // Also watch the diff container parent for portal-style textareas
  const container = row.closest('[class*="diff"]') ?? row.closest('table') ?? row.parentElement;
  observer.observe(container, { childList: true, subtree: true });
}
```

Also increase default timeout from 2000ms to 4000ms.

## Implementation Order

1. **Fix 3** (findDiffRow right-side targeting) — smallest, most impactful for comment trigger failures
2. **Fix 4** (line-mapper right-side scraping) — prevents scraping wrong side
3. **Fix 2** (triggerAddCommentButton rewrite) — core fix for "could not open comment form"
4. **Fix 7** (broader textarea search) — supports Fix 2
5. **Fix 6** (retry logic) — safety net for timing issues
6. **Fix 1** (debounced toggle observer) — fixes race conditions
7. **Fix 5** (auto-prime scrape) — eliminates manual toggle requirement

## Testing Strategy

- Load PR with markdown file showing rich diff by default → verify commenting works without manual toggle
- Toggle rich <-> source rapidly → verify no stale state
- Comment on a line in a long diff (line > 100) → verify correct line targeted
- Comment on a file that was lazy-loaded → verify scrape happens
- Split diff view → verify right-side targeting
- Slow connection (throttle network) → verify retry logic handles slow React hydration

## Version Bump

Bump `manifest.json` version from `0.3.6` to `0.3.7` per project convention.
