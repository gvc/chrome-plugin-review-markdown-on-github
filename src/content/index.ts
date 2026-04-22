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
  fetchRawMarkdown,
  buildLineMap,
  buildElementLineMap,
  clearCaches as clearLineMapCaches,
} from './line-mapper';
import { attachClickHandlers, detachClickHandlers } from './click-handler';
import { showCommentForm } from './comment-form';
import { fetchPRComments, renderCommentBadges } from './comment-overlay';

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
    }

    // Watch for rich diff toggle
    observeRichDiffToggle(container, async (active) => {
      const article = getMarkdownArticle(container);
      if (active && article) {
        await processFile(container, filePath, payload, comments);
      } else if (article) {
        detachClickHandlers(article);
      }
    });

    markProcessed(container);
  }
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

  // Attach click handlers for commenting
  attachClickHandlers(article, lineMap, filePath, (element, match) => {
    showCommentForm(element, match, payload, (body, m, p) =>
      submitComment(body, m, p)
    );
  });

  // Show existing comments
  renderCommentBadges(comments, filePath, lineToElement);
}

// --- Comment submission ---

function getCSRFToken(): string | null {
  // Method 1: meta tag
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute('content');

  // Method 2: form hidden input
  const input = document.querySelector(
    'input[name="authenticity_token"]'
  ) as HTMLInputElement | null;
  if (input) return input.value;

  return null;
}

async function submitComment(
  body: string,
  match: LineMatch,
  payload: GitHubPayload
): Promise<boolean> {
  const { owner, repo, prNumber, headCommitOid } = payload;

  if (!headCommitOid) {
    throw new Error('Cannot determine commit SHA. Try reloading the page.');
  }

  // Try CSRF-based submission first (uses GitHub session)
  const csrfToken = getCSRFToken();
  if (csrfToken) {
    try {
      const success = await submitViaCsrf(
        owner, repo, prNumber, body, match.filePath,
        match.lineNumber, headCommitOid, csrfToken
      );
      if (success) return true;
    } catch {
      // Fall through to PAT
    }
  }

  // Fallback: PAT-based via background worker
  const { pat } = await chrome.storage.sync.get('pat');
  if (pat) {
    return submitViaPat(
      pat, owner, repo, prNumber, body,
      match.filePath, match.lineNumber, headCommitOid
    );
  }

  throw new Error(
    'Could not authenticate. Please configure a GitHub token in the extension popup.'
  );
}

async function submitViaCsrf(
  owner: string, repo: string, prNumber: number,
  body: string, path: string, line: number,
  commitId: string, csrfToken: string
): Promise<boolean> {
  const resp = await fetch(
    `https://github.com/${owner}/${repo}/pull/${prNumber}/review_comment`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        authenticity_token: csrfToken,
        'pull_request_review_comment[body]': body,
        'pull_request_review_comment[path]': path,
        'pull_request_review_comment[line]': String(line),
        'pull_request_review_comment[side]': 'RIGHT',
        'pull_request_review_comment[commit_id]': commitId,
      }),
    }
  );
  return resp.ok;
}

async function submitViaPat(
  token: string, owner: string, repo: string, prNumber: number,
  body: string, path: string, line: number, commitId: string
): Promise<boolean> {
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        body,
        commit_id: commitId,
        path,
        line,
        side: 'RIGHT',
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message ?? `API error ${resp.status}`);
  }

  return true;
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
        if (node instanceof HTMLElement && node.classList?.contains('file')) {
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
    initialize();
  }, 300);
}

// --- Bootstrap ---

initialize();
setupNavigationListeners();
