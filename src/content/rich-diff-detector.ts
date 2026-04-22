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
