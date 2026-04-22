import { switchToSourceDiff } from './rich-diff-detector';

export interface TriggerResult {
  success: boolean;
  error?: string;
}

/**
 * Switch to source diff, find the target line, open GitHub's native comment form,
 * and pre-fill the textarea with the provided text.
 */
export async function triggerNativeCommentOnLine(
  container: HTMLElement,
  lineNumber: number,
  prefillText?: string
): Promise<TriggerResult> {
  // Step 1: Switch to source diff view
  const switched = await switchToSourceDiff(container);
  if (!switched) {
    return {
      success: false,
      error: 'Could not switch to source diff view. Try clicking the "Source" button manually.',
    };
  }

  // Step 2: Find the target line row
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

  // Step 3: Scroll to the row
  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Small delay to let scroll settle
  await delay(150);

  // Step 4: Trigger GitHub's native add-comment button
  const opened = await triggerAddCommentButton(targetRow);
  if (!opened) {
    return {
      success: false,
      error: `Could not open comment form for line ${lineNumber}. GitHub's UI may have changed.`,
    };
  }

  // Step 5: Pre-fill textarea if text provided
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
  // Prefer right-side (addition or context) — same logic as old source-diff-renderer
  const cells = table.querySelectorAll<HTMLTableCellElement>(
    `td[data-line-number="${lineNumber}"]`
  );

  for (const cell of cells) {
    if (
      cell.classList.contains('blob-num-addition') ||
      cell.classList.contains('blob-num-context')
    ) {
      return cell.closest('tr');
    }
  }

  // Fall back to any cell with that line number
  if (cells.length > 0) {
    return cells[cells.length - 1].closest('tr');
  }

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

  // Also hover the line number cells
  for (const cell of row.querySelectorAll<HTMLElement>('td[data-line-number]')) {
    cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  await delay(100);

  // Look for button that appeared after hover
  const hoverBtn = row.querySelector<HTMLElement>(
    'button[aria-label*="comment"], button[data-line], button[data-testid*="comment"]'
  );
  if (hoverBtn) {
    hoverBtn.click();
    return true;
  }

  // Strategy 3: Click the line number cell directly (GitHub sometimes handles this)
  const numCell = row.querySelector<HTMLElement>('td[data-line-number]');
  if (numCell) {
    numCell.click();
    await delay(200);
    // Check if a comment form appeared below this row
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
    // Check immediately
    const check = (): HTMLTextAreaElement | null => {
      // GitHub injects the comment form as a sibling row below the target row
      let sibling: Element | null = row.nextElementSibling;
      while (sibling) {
        const ta = sibling.querySelector<HTMLTextAreaElement>(
          'textarea.comment-form-textarea, textarea[name="comment[body]"], textarea[placeholder*="comment"], textarea[aria-label*="comment"]'
        );
        if (ta) return ta;
        // Stop searching after a few rows
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

    // Observe from the parent table for new rows
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

/**
 * Fill a textarea in a way that React's synthetic event system recognises.
 * Simply setting .value = text doesn't fire React's onChange.
 */
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
