import { GitHubPayload, LineMatch } from '../shared/types';
import { extractPayload, clearPayloadCache } from './payload-extractor';
import {
  findMarkdownFileContainers,
  isRichDiffActive,
  getMarkdownArticle,
  observeRichDiffToggle,
  markProcessed,
  isProcessed,
} from './rich-diff-detector';
import {
  scrapeRawFromSourceDiff,
  clearScrapedCache,
  buildLineMap,
  buildElementLineMap,
  clearCaches as clearLineMapCaches,
} from './line-mapper';
import { attachClickHandlers, detachClickHandlers } from './click-handler';
import { showCommentForm } from './comment-form';
import { triggerNativeCommentOnLine } from './native-comment-trigger';
import { enqueueComment, dequeueComments, hasQueued, clearQueue } from './comment-queue';

async function initialize(): Promise<void> {
  const { enabled } = await chrome.storage.sync.get('enabled');
  if (enabled === false) return;

  const payload = extractPayload();
  if (!payload) {
    console.debug('[MDR] Could not extract GitHub payload');
    return;
  }

  console.debug('[MDR] Payload extracted:', payload.owner, payload.repo, '#' + payload.prNumber);

  const containers = findMarkdownFileContainers();
  console.debug(`[MDR] Found ${containers.length} markdown file(s)`);

  for (const { container, filePath } of containers) {
    if (isProcessed(container)) continue;

    if (isRichDiffActive(container)) {
      // Rich diff already active — no source table in DOM yet, nothing to scrape.
      // The toggle observer below will scrape when the user first switches to source diff,
      // then processFile when they switch back to rich diff.
    } else {
      // Source diff is active — scrape raw markdown now while table is in DOM.
      const scraped = scrapeRawFromSourceDiff(container, filePath);
      console.debug(`[MDR] Init scrape for ${filePath}: ${scraped ? scraped.split('\n').length + ' lines' : 'null (will retry on toggle)'}`);
    }

    // Watch for future rich/source diff toggles
    let lastRichDiffState = isRichDiffActive(container);
    let processingFile = false;

    observeRichDiffToggle(container, async (active) => {
      // Ignore mutations that didn't actually change the view state
      if (active === lastRichDiffState) return;
      lastRichDiffState = active;

      const article = getMarkdownArticle(container);
      if (active && article) {
        // Switched to rich diff — ensure we have raw markdown
        // Try scraping now in case init scrape failed (e.g. lazy-loaded table)
        const raw = scrapeRawFromSourceDiff(container, filePath);
        if (!raw) {
          console.warn(`[MDR] No cached raw markdown for ${filePath} — toggle to Source diff first`);
          return;
        }
        if (processingFile) return;
        processingFile = true;
        try {
          await processFile(container, filePath, payload);
        } finally {
          processingFile = false;
        }
      } else {
        // Switched to source diff — clear stale cache and re-scrape
        clearScrapedCache(filePath);
        scrapeRawFromSourceDiff(container, filePath);
        if (article) detachClickHandlers(article);
        // Flush any queued comments for this file
        if (hasQueued(filePath)) {
          await flushQueue(container, filePath);
        }
      }
    });

    markProcessed(container);
  }
}


async function processFile(
  container: HTMLElement,
  filePath: string,
  payload: GitHubPayload
): Promise<void> {
  const article = getMarkdownArticle(container);
  if (!article) return;

  console.debug(`[MDR] Processing ${filePath}`);

  const raw = scrapeRawFromSourceDiff(container, filePath);
  if (!raw) {
    console.warn(`[MDR] No raw markdown available for ${filePath}`);
    return;
  }

  const lineMap = buildLineMap(raw);
  console.debug(`[MDR] Line map built: ${lineMap.length} lines for ${filePath}`);

  const { elementToLine } = buildElementLineMap(article, lineMap, filePath);
  console.debug(`[MDR] Mapped ${elementToLine.size} elements to lines`);

  // Attach click handlers — clicking opens comment form
  attachClickHandlers(article, lineMap, filePath, (element, match) => {
    showCommentForm(element, match, payload, (body, m) =>
      Promise.resolve(openNativeComment(filePath, body, m))
    );
  });
}

function openNativeComment(
  filePath: string,
  body: string,
  match: LineMatch
): boolean {
  enqueueComment(filePath, match.lineNumber, body);
  const queued = 1; // future: could show total count
  showToast(`${queued} comment queued — switch to Source diff to post it`);
  return true;
}

async function flushQueue(container: HTMLElement, filePath: string): Promise<void> {
  const comments = dequeueComments(filePath);
  if (comments.length === 0) return;

  // Sort by line number so they open in order
  comments.sort((a, b) => a.lineNumber - b.lineNumber);

  for (const { lineNumber, body } of comments) {
    const result = await triggerNativeCommentOnLine(container, lineNumber, body);
    if (!result.success) {
      console.warn(`[MDR] Could not trigger comment on line ${lineNumber}:`, result.error);
      // Re-queue on failure so user doesn't lose the text
      enqueueComment(filePath, lineNumber, body);
      showToast(`Could not open comment form for line ${lineNumber}.\n${result.error ?? ''}`);
    }
    // Small delay between multiple comments so GitHub's UI can settle
    if (comments.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'mdr-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('mdr-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('mdr-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- SPA navigation handling ---

function setupNavigationListeners(): void {
  document.addEventListener('turbo:load', reinitialize);
  window.addEventListener('popstate', reinitialize);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && (
          node.classList?.contains('file') ||
          node.className?.includes?.('diffEntry')
        )) {
          reinitialize();
          return;
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

let reinitTimeout: ReturnType<typeof setTimeout> | null = null;

function reinitialize(): void {
  if (reinitTimeout) clearTimeout(reinitTimeout);
  reinitTimeout = setTimeout(() => {
    clearPayloadCache();
    clearLineMapCaches();
    clearQueue();
    initialize();
  }, 300);
}

// --- Bootstrap ---

initialize();
setupNavigationListeners();
