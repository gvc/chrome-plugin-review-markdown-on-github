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
  const fileElements = document.querySelectorAll<HTMLElement>('.file[data-tagsearch-path]');

  for (const el of fileElements) {
    const path = el.getAttribute('data-tagsearch-path') ?? '';
    const lower = path.toLowerCase();
    if (MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      results.push({ container: el, filePath: path });
    }
  }

  return results;
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
    'article.markdown-body, .js-file-content article, .js-file-content .markdown-body'
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
    container.querySelector('.js-file-content') ?? container;

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
