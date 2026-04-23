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
import { enqueueComment, dequeueComment, getQueuedComments, getCommentForLine, updateComment, hasQueued, getQueuedCount, getAllQueued, restoreQueue } from './comment-queue';
import { parsePRUrl, makePrKey } from '../shared/url-parser';
import { purgeStale } from './comment-store';

async function initialize(): Promise<void> {
  const { enabled } = await chrome.storage.sync.get('enabled');
  if (enabled === false) return;

  const payload = extractPayload();
  if (!payload) {
    console.debug('[MDR] Could not extract GitHub payload');
    return;
  }

  console.debug('[MDR] Payload extracted:', payload.owner, payload.repo, '#' + payload.prNumber);

  // Restore persisted comments and purge stale ones
  const prUrl = parsePRUrl();
  if (prUrl) {
    const prKey = makePrKey(prUrl);
    const restored = await restoreQueue(prKey);
    if (restored > 0) {
      showToast(`${restored} queued comment(s) restored — switch to Source diff to post`);
    }
    await purgeStale(7 * 24 * 60 * 60 * 1000);
  }

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

      // If scrape failed, the table is probably lazy-loaded (file below the fold).
      // Watch for it to appear so we have raw markdown ready before first toggle.
      if (!scraped) {
        observeTableInsertion(container, filePath);
      }
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
          await processFile(container, filePath);
        } finally {
          processingFile = false;
        }
      } else {
        // Switched to source diff — clear stale cache and re-scrape
        clearScrapedCache(filePath);
        scrapeRawFromSourceDiff(container, filePath);
        if (article) detachClickHandlers(article);
        // Dump all queued comments to console as last-resort backup
        const allQueued = getAllQueued();
        if (allQueued.size > 0) {
          console.info('[MDR] All queued comments (backup dump):');
          for (const [fp, comments] of allQueued) {
            for (const c of comments) {
              console.info(`[MDR]   ${fp}:${c.lineNumber} — ${c.body}`);
            }
          }
        }
        // Flush any queued comments for this file
        if (hasQueued(filePath)) {
          await flushQueue(container, filePath);
        }
      }
    });

    markProcessed(container);
  }
}


/**
 * Watch for a lazy-loaded diff table to appear in the container.
 * Once found, scrape it immediately so raw markdown is ready for the first
 * rich-diff toggle. Disconnects after a successful scrape or after 30s.
 */
function observeTableInsertion(container: HTMLElement, filePath: string): void {
  const observer = new MutationObserver(() => {
    const scraped = scrapeRawFromSourceDiff(container, filePath);
    if (scraped) {
      console.debug(`[MDR] Lazy-loaded table scraped for ${filePath}: ${scraped.split('\n').length} lines`);
      observer.disconnect();
    }
  });

  // Table may appear as a child of container OR as a sibling (new GitHub DOM).
  // Observe the parent to catch both cases.
  const target = container.parentElement ?? container;
  observer.observe(target, { childList: true, subtree: true });

  // Don't leak observers — give up after 30s
  setTimeout(() => observer.disconnect(), 30_000);
}

async function processFile(
  container: HTMLElement,
  filePath: string
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

  const { elementToLine, lineToElement } = buildElementLineMap(article, lineMap, filePath);
  console.debug(`[MDR] Mapped ${elementToLine.size} elements to lines`);

  applyCommentedIndicators(filePath, lineToElement);

  // Attach click handlers — clicking opens comment form
  attachClickHandlers(article, lineMap, filePath, (element, match) => {
    const existing = getCommentForLine(filePath, match.lineNumber);
    if (existing) {
      showCommentForm(
        element,
        match,
        async (body, m) => {
          await updateComment(filePath, existing.id, body);
          showToast('Comment updated');
          return true;
        },
        existing,
        async (commentId) => {
          await dequeueComment(filePath, commentId);
          element.classList.remove('mdr-commented');
          showToast('Comment removed');
        }
      );
    } else {
      showCommentForm(element, match, async (body, m) => {
        const success = await openNativeComment(filePath, body, m);
        if (success) element.classList.add('mdr-commented');
        return success;
      });
    }
  });
}

function applyCommentedIndicators(
  filePath: string,
  lineToElement: Map<number, HTMLElement>
): void {
  const comments = getQueuedComments(filePath);
  for (const comment of comments) {
    const el = lineToElement.get(comment.lineNumber);
    if (el) el.classList.add('mdr-commented');
  }
}

async function openNativeComment(
  filePath: string,
  body: string,
  match: LineMatch
): Promise<boolean> {
  await enqueueComment(filePath, match.lineNumber, body);
  const count = getQueuedCount();
  showToast(`${count} comment(s) queued — switch to Source diff to post`);
  return true;
}

async function flushQueue(container: HTMLElement, filePath: string): Promise<void> {
  const comments = getQueuedComments(filePath);
  if (comments.length === 0) return;

  const sorted = [...comments].sort((a, b) => a.lineNumber - b.lineNumber);

  for (const comment of sorted) {
    const result = await triggerNativeCommentOnLine(container, comment.lineNumber, comment.body);
    if (result.success) {
      await dequeueComment(filePath, comment.id);
    } else {
      console.warn(`[MDR] Could not trigger comment on line ${comment.lineNumber}:`, result.error);
      showToast(`Could not open comment form for line ${comment.lineNumber}.\n${result.error ?? ''}`);
      // Comment stays in storage — will retry on next source diff toggle
    }
    if (sorted.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Last resort: dump any remaining comments to console so they're never truly lost
  const remaining = getQueuedComments(filePath);
  if (remaining.length > 0) {
    console.warn(`[MDR] ${remaining.length} comment(s) could not be posted for ${filePath}. Dumping to console as backup:`);
    for (const c of remaining) {
      console.warn(`[MDR]   Line ${c.lineNumber}: ${c.body}`);
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
    // DO NOT clear queue — persisted comments must survive navigation
    initialize();
  }, 300);
}

// --- Bootstrap ---

initialize();
setupNavigationListeners();
