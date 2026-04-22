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

  const opened = await triggerAddCommentButton(targetRow);
  if (!opened) {
    return {
      success: false,
      error: `Could not open comment form for line ${lineNumber}. GitHub's UI may have changed.`,
    };
  }

  if (prefillText) {
    const textarea = await waitForCommentTextarea(targetRow, 2000);
    if (textarea) {
      fillTextareaReact(textarea, prefillText);
      textarea.focus();
    }
  }

  return { success: true };
}

// --- Internal helpers ---

function findDiffRow(table: HTMLElement, lineNumber: number): HTMLTableRowElement | null {
  // New GitHub DOM (2024+): td.new-diff-line-number
  const newCell = table.querySelector<HTMLTableCellElement>(
    `td.new-diff-line-number[data-line-number="${lineNumber}"]`
  );
  if (newCell) return newCell.closest('tr');

  // Old GitHub DOM fallback
  const oldCell = table.querySelector<HTMLTableCellElement>(
    `td.blob-num-addition[data-line-number="${lineNumber}"], td.blob-num-context[data-line-number="${lineNumber}"]`
  );
  if (oldCell) return oldCell.closest('tr');

  // Last resort: any td with this line number
  const anyCell = table.querySelector<HTMLTableCellElement>(
    `td[data-line-number="${lineNumber}"]`
  );
  if (anyCell) return anyCell.closest('tr');

  return null;
}

async function triggerAddCommentButton(row: HTMLTableRowElement): Promise<boolean> {
  // Strategy 1: GitHub's legacy js-add-line-comment class
  const jsBtn = row.querySelector<HTMLElement>('button.js-add-line-comment, .js-add-line-comment');
  if (jsBtn) {
    jsBtn.click();
    return true;
  }

  // Strategy 2: GitHub's new React diff UI (2024+)
  // The comment form lives inline inside td[data-line-number][role="dialog"].
  // Clicking the td (right-side-diff-cell) opens the inline markers dialog.
  const diffCell = row.querySelector<HTMLElement>(
    'td.right-side-diff-cell[data-line-number], td[data-diff-side="right"][data-line-number]'
  );
  if (diffCell) {
    // If already open, no need to click again
    const alreadyOpen = diffCell.querySelector<HTMLElement>(
      'div[data-inline-markers][aria-hidden="false"]'
    );
    if (alreadyOpen) return true;

    diffCell.click();
    await delay(200);

    const opened = diffCell.querySelector<HTMLElement>(
      'div[data-inline-markers][aria-hidden="false"]'
    );
    if (opened) return true;
  }

  // Strategy 3: Hover the row to reveal button, then click
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  for (const cell of row.querySelectorAll<HTMLElement>('td[data-line-number]')) {
    cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  await delay(150);

  const hoverBtn = row.querySelector<HTMLElement>(
    'button[aria-label*="comment"], button[data-line], button[data-testid*="comment"]'
  );
  if (hoverBtn) {
    hoverBtn.click();
    return true;
  }

  // Strategy 4: Click the line number cell directly, check for textarea anywhere in row
  const numCell = row.querySelector<HTMLElement>('td.new-diff-line-number, td[data-line-number]');
  if (numCell) {
    numCell.click();
    await delay(250);
    if (row.querySelector('textarea')) {
      return true;
    }
    // Also check next sibling row (legacy GitHub)
    const nextRow = row.nextElementSibling;
    if (nextRow?.querySelector('textarea, .comment-form-textarea')) {
      return true;
    }
  }

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

    const table = row.closest('table') ?? row.parentElement;
    if (table) {
      observer.observe(table, { childList: true, subtree: true });
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
