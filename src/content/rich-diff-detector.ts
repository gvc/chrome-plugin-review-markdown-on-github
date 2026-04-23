export interface FileContainer {
  container: HTMLElement;
  filePath: string;
}

const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'];

/**
 * Find all markdown file containers on the PR files page.
 */
export function findMarkdownFileContainers(): FileContainer[] {
  const results: FileContainer[] = [];

  // Strategy 1: Legacy selector (older GitHub DOM)
  const legacyElements = document.querySelectorAll<HTMLElement>('.file[data-tagsearch-path]');
  for (const el of legacyElements) {
    const path = el.getAttribute('data-tagsearch-path') ?? '';
    const lower = path.toLowerCase();
    if (MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      results.push({ container: el, filePath: path });
    }
  }
  if (results.length > 0) return results;

  // Strategy 2: New GitHub DOM — diff entries with hashed CSS module classes.
  // The diffEntry element is just the file header; the diff table and rendered
  // article live in sibling elements under the same parent.  Use the parent only
  // when it contains exactly one diffEntry (i.e. it's a per-file wrapper).
  // Otherwise keep el itself and rely on sibling-aware helpers below.
  const allDiffEntries = document.querySelectorAll<HTMLElement>('[class*="diffEntry"]');

  // Pre-count entries per parent to avoid O(n²) querySelectorAll inside the loop.
  const entriesPerParent = new Map<HTMLElement, number>();
  for (const el of allDiffEntries) {
    const parent = el.parentElement;
    if (parent) entriesPerParent.set(parent, (entriesPerParent.get(parent) ?? 0) + 1);
  }

  for (const el of allDiffEntries) {
    const filePath = extractFilePathFromContainer(el);
    if (!filePath) continue;
    const lower = filePath.toLowerCase();
    if (!MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;

    const parent = el.parentElement;
    // Safe to use parent only when it wraps exactly this one file.
    const container = (parent && entriesPerParent.get(parent) === 1) ? parent : el;
    results.push({ container, filePath });
  }

  return results;
}

/**
 * Walk forward siblings of `el` until either `predicate` returns a match or a
 * diffEntry boundary is hit.  Returns the matched sibling or null.
 */
export function findSibling(
  el: HTMLElement,
  predicate: (sibling: HTMLElement) => HTMLElement | null
): HTMLElement | null {
  let sibling = el.nextElementSibling as HTMLElement | null;
  while (sibling) {
    if (sibling.className?.includes?.('diffEntry')) break;
    const found = predicate(sibling);
    if (found) return found;
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return null;
}

/**
 * Extract file path from a diff entry container by looking at header links/text.
 */
function extractFilePathFromContainer(container: HTMLElement): string | null {
  // Prefer data attributes — unambiguous, no text parsing needed
  const dataPath =
    container.getAttribute('data-tagsearch-path') ??
    container.getAttribute('data-path') ??
    container.getAttribute('data-file-path');
  if (dataPath) return dataPath;

  // Look for a link whose href contains the diff anchor — the text is the file path
  const diffLink = container.querySelector<HTMLAnchorElement>('a[href*="#diff-"]');
  if (diffLink) {
    const text = (diffLink.getAttribute('title') || diffLink.textContent || '')
      .trim()
      .replace(/[\u200E\u200F\u200B]/g, '');
    if (text && text.includes('.') && !text.includes(' ')) return text;
  }

  // Look for elements with a title that looks like a file path
  const titledEls = container.querySelectorAll<HTMLElement>('[title]');
  for (const el of titledEls) {
    const text = el.getAttribute('title')!.trim().replace(/[\u200E\u200F\u200B]/g, '');
    if (text && /^[\w./-]+\.\w+$/.test(text) && !text.includes(' ')) return text;
  }

  // Last resort: only look inside known file-header sub-elements, never in the diff body
  const headerEl = container.querySelector<HTMLElement>(
    '[class*="fileHeader"], [class*="file-header"], [class*="fileName"], [class*="file-name"]'
  );
  if (headerEl) {
    const spans = headerEl.querySelectorAll<HTMLElement>('a, span');
    for (const el of spans) {
      const text = (el.textContent || '').trim().replace(/[\u200E\u200F\u200B]/g, '');
      if (text && /^[\w./-]+\.\w+$/.test(text)) return text;
    }
  }

  return null;
}

/**
 * Check if a file container is currently showing the rich diff (rendered markdown).
 */
export function isRichDiffActive(container: HTMLElement): boolean {
  const article = getMarkdownArticle(container);
  if (!article) return false;
  // Check visibility
  return article.offsetHeight > 0 && article.children.length > 0;
}

/**
 * Get the rendered markdown <article> element from a file container.
 * When container is a diffEntry header (siblings hold the content), also
 * searches forward siblings up to the next diffEntry.
 */
export function getMarkdownArticle(container: HTMLElement): HTMLElement | null {
  const SELECTOR =
    'article.markdown-body, .js-file-content article, .js-file-content .markdown-body, .prose-diff article.markdown-body';
  const selectorList = SELECTOR.split(',').join(', ');

  return (
    container.querySelector<HTMLElement>(SELECTOR) ??
    findSibling(container, (s) =>
      s.matches(selectorList) ? s : s.querySelector<HTMLElement>(SELECTOR)
    )
  );
}

/**
 * Find the content sibling (table or article wrapper) for a diffEntry-style container.
 * Falls back to the container itself for legacy/wrapped layouts.
 */
function findContentRoot(container: HTMLElement): HTMLElement {
  const desc =
    container.querySelector<HTMLElement>('.js-file-content') ??
    container.querySelector<HTMLElement>('.prose-diff');
  if (desc) return desc;

  return findSibling(container, (s) =>
    s.querySelector('table') ||
    s.querySelector('article.markdown-body') ||
    s.classList?.contains('js-file-content') ||
    s.classList?.contains('prose-diff')
      ? s
      : null
  ) ?? container;
}

/**
 * Observe a file container for rich diff toggle changes.
 * Calls the callback when the rendered markdown appears or disappears.
 */
export function observeRichDiffToggle(
  container: HTMLElement,
  callback: (active: boolean) => void
): MutationObserver {
  const contentDiv = findContentRoot(container);

  const observer = new MutationObserver(() => {
    callback(isRichDiffActive(container));
  });

  observer.observe(contentDiv, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'],
  });

  return observer;
}

const PROCESSED_ATTR = 'data-mdr-processed';

export function markProcessed(container: HTMLElement): void {
  container.setAttribute(PROCESSED_ATTR, 'true');
}

export function isProcessed(container: HTMLElement): boolean {
  return container.hasAttribute(PROCESSED_ATTR);
}

// --- Diff view toggling ---

/**
 * Find the toggle button for switching between source diff and rich diff.
 * GitHub uses various button styles across versions.
 */
export function findDiffToggleButton(
  container: HTMLElement,
  targetMode: 'source' | 'rich'
): HTMLElement | null {
  const sourceLabels = ['Display the source diff', 'Source diff', 'Source'];
  const richLabels = ['Display the rich diff', 'Rich diff', 'Rich'];
  const labels = targetMode === 'source' ? sourceLabels : richLabels;

  // Strategy 1: aria-label or title attributes
  for (const label of labels) {
    const btn = container.querySelector<HTMLElement>(
      `button[aria-label="${label}"], button[title="${label}"]`
    );
    if (btn) return btn;
  }

  // Strategy 2: button text content
  const buttons = container.querySelectorAll<HTMLElement>('button');
  for (const btn of buttons) {
    const text = (btn.textContent ?? '').trim().toLowerCase();
    if (targetMode === 'source' && (text === 'source' || text === 'source diff')) return btn;
    if (targetMode === 'rich' && (text === 'rich diff' || text === 'rich')) return btn;
  }

  // Strategy 3: tab/segmented control roles
  const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
  for (const tab of tabs) {
    const text = (tab.textContent ?? '').trim().toLowerCase();
    if (targetMode === 'source' && text.includes('source')) return tab;
    if (targetMode === 'rich' && text.includes('rich')) return tab;
  }

  return null;
}

/**
 * Switch the file container to source diff view.
 * Returns a promise that resolves when the table is visible, or rejects on timeout.
 */
export function switchToSourceDiff(container: HTMLElement): Promise<boolean> {
  if (!isRichDiffActive(container)) return Promise.resolve(true); // already source

  const btn = findDiffToggleButton(container, 'source');
  if (!btn) return Promise.resolve(false);

  btn.click();
  return waitForSourceDiff(container, 3000);
}

/**
 * Switch the file container to rich diff view.
 * Returns a promise that resolves when the article is visible, or false on timeout.
 */
export function switchToRichDiff(container: HTMLElement): Promise<boolean> {
  if (isRichDiffActive(container)) return Promise.resolve(true); // already rich

  const btn = findDiffToggleButton(container, 'rich');
  if (!btn) return Promise.resolve(false);

  btn.click();
  return waitForRichDiff(container, 3000);
}

function hasTable(container: HTMLElement): boolean {
  return !!(
    container.querySelector('table') ??
    findSibling(container, (s) => (s.tagName === 'TABLE' ? s : s.querySelector('table')))
  );
}

function waitForSourceDiff(container: HTMLElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (hasTable(container)) {
      resolve(true);
      return;
    }

    const observeTarget = findContentRoot(container);
    const observer = new MutationObserver(() => {
      if (hasTable(container)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(true);
      }
    });
    observer.observe(observeTarget, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}

function waitForRichDiff(container: HTMLElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (isRichDiffActive(container)) {
      resolve(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (isRichDiffActive(container)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(true);
      }
    });
    const observeTarget = findContentRoot(container);
    observer.observe(observeTarget, { childList: true, subtree: true, attributes: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}
