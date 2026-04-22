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
  // Strategy 1: GitHub's long-standing js-add-line-comment class
  const jsBtn = row.querySelector<HTMLElement>('button.js-add-line-comment, .js-add-line-comment');
  if (jsBtn) {
    jsBtn.click();
    return true;
  }

  // Strategy 2: Hover the row to reveal the button, then click it
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  for (const cell of row.querySelectorAll<HTMLElement>('td[data-line-number]')) {
    cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  await delay(100);

  const hoverBtn = row.querySelector<HTMLElement>(
    'button[aria-label*="comment"], button[data-line], button[data-testid*="comment"]'
  );
  if (hoverBtn) {
    hoverBtn.click();
    return true;
  }

  // Strategy 3: Click the line number cell directly
  const numCell = row.querySelector<HTMLElement>('td.new-diff-line-number, td[data-line-number]');
  if (numCell) {
    numCell.click();
    await delay(200);
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
