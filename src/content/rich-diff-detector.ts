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

  // Strategy 2: New GitHub DOM — diff entries with hashed CSS module classes
  const allDiffEntries = document.querySelectorAll<HTMLElement>('[class*="diffEntry"]');
  for (const el of allDiffEntries) {
    const filePath = extractFilePathFromContainer(el);
    if (!filePath) continue;
    const lower = filePath.toLowerCase();
    if (MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      results.push({ container: el, filePath });
    }
  }

  return results;
}

/**
 * Extract file path from a diff entry container by looking at header links/text.
 */
function extractFilePathFromContainer(container: HTMLElement): string | null {
  // Look for a link or element with a title/text that looks like a file path
  const candidates = container.querySelectorAll<HTMLElement>(
    'a[title], a[href*="#diff"], [title], button[aria-label]'
  );
  for (const el of candidates) {
    const text = (el.getAttribute('title') || el.textContent || '').trim()
      // Strip invisible LRM/RLM unicode markers GitHub adds
      .replace(/[\u200E\u200F\u200B]/g, '');
    if (text && text.includes('.') && !text.includes(' ')) {
      return text;
    }
  }

  // Fallback: find any element whose text looks like a file path
  const allText = container.querySelectorAll<HTMLElement>('a, span');
  for (const el of allText) {
    const text = (el.textContent || '').trim().replace(/[\u200E\u200F\u200B]/g, '');
    if (text && /^[\w./-]+\.\w+$/.test(text)) {
      return text;
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
 */
export function getMarkdownArticle(container: HTMLElement): HTMLElement | null {
  // Primary selector: article with markdown-body class
  const article = container.querySelector<HTMLElement>(
    'article.markdown-body, .js-file-content article, .js-file-content .markdown-body, .prose-diff article.markdown-body'
  );
  return article;
}

/**
 * Observe a file container for rich diff toggle changes.
 * Calls the callback when the rendered markdown appears or disappears.
 */
export function observeRichDiffToggle(
  container: HTMLElement,
  callback: (active: boolean) => void
): MutationObserver {
  const contentDiv =
    container.querySelector('.js-file-content') ??
    container.querySelector('.prose-diff') ??
    container;

  const observer = new MutationObserver(() => {
    callback(isRichDiffActive(container));
  });

  observer.observe(contentDiv, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
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

function waitForSourceDiff(container: HTMLElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (container.querySelector('table')) {
      resolve(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (container.querySelector('table')) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(true);
      }
    });
    observer.observe(container, { childList: true, subtree: true });

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
    observer.observe(container, { childList: true, subtree: true, attributes: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}
