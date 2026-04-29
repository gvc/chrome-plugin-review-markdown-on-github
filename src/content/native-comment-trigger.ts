export interface TriggerResult {
  success: boolean;
  error?: string;
}

/**
 * Find the target line row in the source diff table and open GitHub's native
 * comment form, pre-filling the textarea with the provided text.
 * Assumes source diff is already active.
 */
export async function triggerNativeCommentOnLine(
  container: HTMLElement,
  lineNumber: number,
  prefillText?: string
): Promise<TriggerResult> {
  const table = container.querySelector<HTMLElement>('table');
  if (!table) {
    return { success: false, error: 'Source diff table not found.' };
  }

  const targetRow = findDiffRow(table, lineNumber);
  if (!targetRow) {
    return {
      success: false,
      error: `Line ${lineNumber} not visible in diff (may be in a collapsed section).`,
    };
  }

  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(150);

  // Retry with backoff — React may not have hydrated the comment UI yet
  let opened = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    opened = await triggerAddCommentButton(targetRow);
    if (opened) break;
    if (attempt < 2) await delay(500 * (attempt + 1));
  }

  if (!opened) {
    return {
      success: false,
      error: `Could not open comment form for line ${lineNumber}. GitHub's UI may have changed.`,
    };
  }

  if (prefillText) {
    const textarea = await waitForCommentTextarea(targetRow, 4000);
    if (textarea) {
      fillTextareaReact(textarea, prefillText);
      textarea.focus();
    }
  }

  return { success: true };
}

// --- Internal helpers ---

function findDiffRow(table: HTMLElement, lineNumber: number): HTMLTableRowElement | null {
  // Target right (head) side — split diffs have the same line number on both sides
  const rightCell = table.querySelector<HTMLTableCellElement>(
    `td[data-diff-side="right"][data-line-number="${lineNumber}"]`
  );
  if (rightCell) return rightCell.closest('tr');

  // Unified diff fallback (no data-diff-side)
  const unifiedCell = table.querySelector<HTMLTableCellElement>(
    `td.new-diff-line-number[data-line-number="${lineNumber}"]:not([data-diff-side="left"])`
  );
  if (unifiedCell) return unifiedCell.closest('tr');

  // Old GitHub DOM fallback
  const oldCell = table.querySelector<HTMLTableCellElement>(
    `td.blob-num-addition[data-line-number="${lineNumber}"], td.blob-num-context[data-line-number="${lineNumber}"]`
  );
  if (oldCell) return oldCell.closest('tr');

  return null;
}

async function triggerAddCommentButton(row: HTMLTableRowElement): Promise<boolean> {
  // Strategy 1: Legacy js-add-line-comment button
  const jsBtn = row.querySelector<HTMLElement>('button.js-add-line-comment, .js-add-line-comment');
  if (jsBtn) {
    jsBtn.click();
    return true;
  }

  // Strategy 2: Simulate hover to make GitHub's React renderer inject the ActionBar
  // add-comment button. The button is NOT in the DOM until mouseenter fires on the row.
  // Dispatch mouseenter/mouseover on the right-side cell (where React's handler lives),
  // then wait for the button to appear and click it.
  const rightNumCell = row.querySelector<HTMLElement>(
    'td[data-diff-side="right"][data-line-number]'
  ) ?? row.querySelector<HTMLElement>(
    'td.new-diff-line-number[data-line-number]:not([data-diff-side="left"])'
  );
  const hoverTarget = rightNumCell ?? row;
  dispatchHover(hoverTarget);
  blinkRow(row);
  await delay(100);

  const addCommentBtn = await waitForElement<HTMLElement>(
    row,
    '[class*="ActionBar-module__addCommentButton"] button, [class*="addCommentButton"] button',
    300
  );
  if (addCommentBtn) {
    addCommentBtn.click();
    await delay(300);
    if (rowHasCommentForm(row)) return true;
  }

  // Strategy 3: Click the right-side line number cell — fallback if hover injection fails
  if (rightNumCell) {
    rightNumCell.click();
    await delay(300);
    if (rowHasCommentForm(row)) return true;
  }

  // Strategy 4: Click the right-side code cell
  const diffCell = row.querySelector<HTMLElement>(
    'td.diff-text-cell[data-diff-side="right"]'
  );
  if (diffCell) {
    const alreadyOpen = diffCell.querySelector<HTMLElement>('div[data-inline-markers][aria-hidden="false"]');
    if (alreadyOpen) return true;
    diffCell.click();
    await delay(300);
    if (rowHasCommentForm(row)) return true;
  }

  // Strategy 5: Any comment button revealed in DOM (some GitHub variants render it)
  const btn = row.querySelector<HTMLElement>(
    'button[aria-label*="comment"], button[data-testid*="comment"]'
  );
  if (btn) {
    btn.click();
    return true;
  }

  return false;
}

/**
 * Briefly highlight the row so the user knows to move their mouse there,
 * which will cause GitHub's React handler to inject the add-comment button.
 */
function blinkRow(row: HTMLTableRowElement): void {
  row.style.setProperty('outline', '2px solid var(--color-accent-emphasis, #0969da)', 'important');
  row.style.setProperty('outline-offset', '-2px', 'important');
  setTimeout(() => {
    row.style.removeProperty('outline');
    row.style.removeProperty('outline-offset');
  }, 1200);
}

/**
 * Dispatch mouseenter + mouseover on el to trigger GitHub's React hover handler,
 * which injects the ActionBar add-comment button into the DOM.
 */
function dispatchHover(el: HTMLElement): void {
  for (const type of ['mouseenter', 'mouseover'] as const) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: type === 'mouseover', cancelable: true, composed: true }));
  }
}

/**
 * Wait for a selector to appear inside root, up to timeoutMs.
 * Returns the element if found, null on timeout.
 */
function waitForElement<T extends HTMLElement>(
  root: HTMLElement,
  selector: string,
  timeoutMs: number
): Promise<T | null> {
  const immediate = root.querySelector<T>(selector);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const found = root.querySelector<T>(selector);
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

function rowHasCommentForm(row: HTMLTableRowElement): boolean {
  if (row.querySelector('textarea')) return true;
  const next = row.nextElementSibling;
  if (next?.querySelector('textarea, .comment-form-textarea')) return true;
  return false;
}

function waitForCommentTextarea(
  row: HTMLTableRowElement,
  timeoutMs: number
): Promise<HTMLTextAreaElement | null> {
  return new Promise((resolve) => {
    const check = (): HTMLTextAreaElement | null => {
      // New GitHub (2024+): textarea is inline inside the row's td
      const inlineTA = row.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Markdown value"], textarea[placeholder="Leave a comment"], textarea.prc-Textarea-TextArea-snlco'
      );
      if (inlineTA) return inlineTA;

      // Legacy: textarea in a sibling row
      let sibling: Element | null = row.nextElementSibling;
      while (sibling) {
        const ta = sibling.querySelector<HTMLTextAreaElement>(
          'textarea.comment-form-textarea, textarea[name="comment[body]"], textarea[placeholder*="comment"], textarea[aria-label*="comment"]'
        );
        if (ta) return ta;
        if (sibling.querySelector('td[data-line-number]')) break;
        sibling = sibling.nextElementSibling;
      }
      return null;
    };

    const immediate = check();
    if (immediate) {
      resolve(immediate);
      return;
    }

    const observer = new MutationObserver(() => {
      const found = check();
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });

    // Fix 7: watch broader scope — textarea may land in portal or diff container
    const watchTarget =
      row.closest('[class*="diff"]') ??
      row.closest('table') ??
      row.parentElement;
    if (watchTarget) {
      observer.observe(watchTarget, { childList: true, subtree: true });
    }

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

function fillTextareaReact(textarea: HTMLTextAreaElement, text: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(textarea, text);
  } else {
    textarea.value = text;
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
