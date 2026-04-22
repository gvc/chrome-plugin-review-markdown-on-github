import { GitHubPayload, LineMatch, DraftComment, PRKey } from '../shared/types';
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
  fetchRawMarkdown,
  buildLineMap,
  buildElementLineMap,
  clearCaches as clearLineMapCaches,
} from './line-mapper';
import { attachClickHandlers, detachClickHandlers } from './click-handler';
import { showCommentForm } from './comment-form';
import { fetchPRComments, renderCommentBadges, renderDraftBadges } from './comment-overlay';
import { buildPRKey, saveDraft, getDrafts, deleteDraft } from './draft-storage';
import { renderDraftsInSourceDiff, clearDraftRenderings } from './source-diff-renderer';
import { installCsrfInterceptor, submitComment } from './comment-submitter';

async function saveDraftComment(
  body: string,
  match: LineMatch,
  payload: GitHubPayload
): Promise<boolean> {
  const prKey = buildPRKey(payload);
  const draft: DraftComment = {
    id: crypto.randomUUID(),
    body,
    filePath: match.filePath,
    lineNumber: match.lineNumber,
    confidence: match.confidence,
    commitOid: payload.headCommitOid,
    createdAt: new Date().toISOString(),
  };
  await saveDraft(prKey, draft);
  return true;
}

async function initialize(): Promise<void> {
  // Check if extension is enabled
  const { enabled } = await chrome.storage.sync.get('enabled');
  if (enabled === false) return;

  const payload = extractPayload();
  if (!payload) {
    console.debug('[MDR] Could not extract GitHub payload');
    return;
  }

  console.debug('[MDR] Payload extracted:', payload.owner, payload.repo, '#' + payload.prNumber);

  // Fetch existing comments once
  const comments = await fetchPRComments(payload);
  console.debug(`[MDR] Fetched ${comments.length} existing comments`);

  // Process all markdown file containers
  const containers = findMarkdownFileContainers();
  console.debug(`[MDR] Found ${containers.length} markdown file(s)`);

  for (const { container, filePath } of containers) {
    if (isProcessed(container)) continue;

    if (isRichDiffActive(container)) {
      await processFile(container, filePath, payload, comments);
    } else {
      // Source diff is active initially — render draft badges in source diff view
      const prKey = buildPRKey(payload);
      renderDraftsInSourceDiff(container, filePath, prKey);
    }

    // Watch for rich diff toggle
    observeRichDiffToggle(container, async (active) => {
      const article = getMarkdownArticle(container);
      if (active && article) {
        clearDraftRenderings(container);
        await processFile(container, filePath, payload, comments);
      } else {
        if (article) detachClickHandlers(article);
        const prKey = buildPRKey(payload);
        renderDraftsInSourceDiff(container, filePath, prKey);
      }
    });

    markProcessed(container);
  }

  await renderSubmitAllButton(payload);
}

async function processFile(
  container: HTMLElement,
  filePath: string,
  payload: GitHubPayload,
  comments: import('../shared/types').PRComment[]
): Promise<void> {
  const article = getMarkdownArticle(container);
  if (!article) return;

  console.debug(`[MDR] Processing ${filePath}`);

  // Fetch raw markdown and build line map
  const raw = await fetchRawMarkdown(filePath, payload);
  if (!raw) {
    console.warn(`[MDR] Could not fetch raw markdown for ${filePath}`);
    return;
  }

  const lineMap = buildLineMap(raw);
  console.debug(`[MDR] Line map built: ${lineMap.length} lines for ${filePath}`);

  // Build element-to-line mapping
  const { elementToLine, lineToElement } = buildElementLineMap(article, lineMap, filePath);
  console.debug(`[MDR] Mapped ${elementToLine.size} elements to lines`);

  // Log mappings for debugging
  for (const [el, match] of elementToLine) {
    const preview = (el.textContent ?? '').slice(0, 50);
    console.debug(`[MDR]   L${match.lineNumber} [${match.confidence}] "${preview}..."`);
  }

  // Attach click handlers for saving draft comments
  attachClickHandlers(article, lineMap, filePath, (element, match) => {
    showCommentForm(element, match, payload, (body, m, p) =>
      saveDraftComment(body, m, p)
    );
  });

  // Show existing comments
  renderCommentBadges(comments, filePath, lineToElement);

  // Show draft badges on rich diff elements
  const prKey = buildPRKey(payload);
  const drafts = await getDrafts(prKey);
  renderDraftBadges(drafts, filePath, lineToElement);
}

// --- Submit All Drafts FAB ---

let submitAllBtn: HTMLButtonElement | null = null;

async function renderSubmitAllButton(payload: GitHubPayload): Promise<void> {
  removeSubmitAllButton();
  const prKey = buildPRKey(payload);
  const drafts = await getDrafts(prKey);
  if (drafts.length === 0) return;

  const btn = document.createElement('button');
  btn.className = 'mdr-submit-all-btn';
  btn.textContent = `Submit ${drafts.length} Draft(s)`;
  btn.addEventListener('click', () => submitAllDrafts(payload));
  document.body.appendChild(btn);
  submitAllBtn = btn;
}

function removeSubmitAllButton(): void {
  if (submitAllBtn) {
    submitAllBtn.remove();
    submitAllBtn = null;
  }
}

async function submitAllDrafts(payload: GitHubPayload): Promise<void> {
  const prKey = buildPRKey(payload);
  const drafts = await getDrafts(prKey);
  if (drafts.length === 0) return;
  if (!submitAllBtn) return;

  submitAllBtn.disabled = true;
  let posted = 0;
  const errors: string[] = [];

  for (const draft of drafts) {
    submitAllBtn.textContent = `Submitting ${posted + 1}/${drafts.length}...`;
    try {
      const match: LineMatch = {
        lineNumber: draft.lineNumber,
        confidence: draft.confidence,
        filePath: draft.filePath,
      };
      const success = await submitComment(draft.body, match, payload);
      if (success) {
        await deleteDraft(prKey, draft.id);
        posted++;
      } else {
        errors.push(`Line ${draft.lineNumber} in ${draft.filePath}: failed`);
      }
    } catch (err) {
      errors.push(`Line ${draft.lineNumber} in ${draft.filePath}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  if (posted > 0) {
    showToast(`${posted} comment(s) posted`);
  }
  if (errors.length > 0) {
    showToast(`${errors.length} comment(s) failed`);
  }

  // Refresh button
  await renderSubmitAllButton(payload);
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
  }, 2000);
}

// --- SPA navigation handling ---

function setupNavigationListeners(): void {
  // GitHub uses Turbo for SPA navigation
  document.addEventListener('turbo:load', reinitialize);
  window.addEventListener('popstate', reinitialize);

  // Also observe DOM for dynamically loaded file containers
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && (
          node.classList?.contains('file') ||
          node.className?.includes?.('diffEntry')
        )) {
          // New file container appeared (lazy load)
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
  // Debounce reinit
  if (reinitTimeout) clearTimeout(reinitTimeout);
  reinitTimeout = setTimeout(() => {
    clearPayloadCache();
    clearLineMapCaches();
    removeSubmitAllButton();
    initialize();
  }, 300);
}

// --- Bootstrap ---

installCsrfInterceptor();
initialize();
setupNavigationListeners();
