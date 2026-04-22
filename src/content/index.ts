import { GitHubPayload, LineMatch } from '../shared/types';
import { extractPayload, clearPayloadCache } from './payload-extractor';
import {
  findMarkdownFileContainers,
  isRichDiffActive,
  getMarkdownArticle,
  observeRichDiffToggle,
  markProcessed,
  isProcessed,
  switchToSourceDiff,
  switchToRichDiff,
} from './rich-diff-detector';
import {
  scrapeRawFromSourceDiff,
  buildLineMap,
  buildElementLineMap,
  clearCaches as clearLineMapCaches,
} from './line-mapper';
import { attachClickHandlers, detachClickHandlers } from './click-handler';
import { showCommentForm } from './comment-form';
import { triggerNativeCommentOnLine } from './native-comment-trigger';

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
      // Rich diff is already active — we need raw markdown to map elements.
      // Briefly switch to source diff to scrape, then switch back.
      await scrapeViaToggle(container, filePath);
      await processFile(container, filePath, payload);
    } else {
      // Source diff is active — scrape raw markdown now while table is in DOM.
      scrapeRawFromSourceDiff(container, filePath);
    }

    // Watch for future rich/source diff toggles
    observeRichDiffToggle(container, async (active) => {
      const article = getMarkdownArticle(container);
      if (active && article) {
        // Switched to rich diff — ensure we have raw markdown
        const raw = scrapeRawFromSourceDiff(container, filePath);
        if (!raw) {
          console.warn(`[MDR] No cached raw markdown for ${filePath} after toggle`);
          return;
        }
        await processFile(container, filePath, payload);
      } else {
        // Switched to source diff — re-scrape (diff may have expanded)
        scrapeRawFromSourceDiff(container, filePath);
        if (article) detachClickHandlers(article);
      }
    });

    markProcessed(container);
  }
}

async function scrapeViaToggle(container: HTMLElement, filePath: string): Promise<void> {
  // Quickly toggle to source diff, scrape, toggle back
  const switched = await switchToSourceDiff(container);
  if (!switched) {
    console.warn(`[MDR] Could not switch to source diff to scrape ${filePath}`);
    return;
  }

  scrapeRawFromSourceDiff(container, filePath);

  // Restore rich diff view
  await switchToRichDiff(container);
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
      openNativeComment(container, body, m)
    );
  });
}

async function openNativeComment(
  container: HTMLElement,
  body: string,
  match: LineMatch
): Promise<boolean> {
  const result = await triggerNativeCommentOnLine(container, match.lineNumber, body);

  if (!result.success) {
    console.warn('[MDR] Native comment trigger failed:', result.error);
    // Copy text to clipboard as fallback
    try {
      await navigator.clipboard.writeText(body);
      showToast(`Could not open comment form. Text copied to clipboard.\n${result.error ?? ''}`);
    } catch {
      showToast(result.error ?? 'Could not open GitHub comment form.');
    }
    return false;
  }

  return true;
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
    initialize();
  }, 300);
}

// --- Bootstrap ---

initialize();
setupNavigationListeners();
