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

// --- CSRF token capture ---
// GitHub's React SPA no longer puts CSRF in meta tags.
// We inject a tiny script into the page's main world to intercept
// fetch() calls and capture the X-CSRF-Token header that GitHub's
// own JS sends with GraphQL requests. The token is relayed back
// to the content script via a custom DOM event.

let capturedCsrfToken: string | null = null;

function installCsrfInterceptor(): void {
  // Listen for the token relayed from the page world
  window.addEventListener('mdr-csrf-captured', ((e: CustomEvent) => {
    capturedCsrfToken = e.detail;
    console.debug('[MDR] Captured CSRF token from GitHub fetch');
  }) as EventListener);

  // Inject script into page's main world to monkey-patch fetch
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const origFetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          const headers = init?.headers;
          if (headers) {
            // Check for CSRF token in headers (Headers object, plain object, or array)
            let token = null;
            if (headers instanceof Headers) {
              token = headers.get('X-CSRF-Token') || headers.get('x-csrf-token');
            } else if (Array.isArray(headers)) {
              const entry = headers.find(function(h) {
                return h[0].toLowerCase() === 'x-csrf-token';
              });
              if (entry) token = entry[1];
            } else if (typeof headers === 'object') {
              token = headers['X-CSRF-Token'] || headers['x-csrf-token'];
            }
            if (token) {
              window.dispatchEvent(new CustomEvent('mdr-csrf-captured', { detail: token }));
            }
          }
        } catch(e) {}
        return origFetch.apply(this, arguments);
      };
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove();
}

function getCSRFToken(): string | null {
  if (capturedCsrfToken) return capturedCsrfToken;

  // Fallback: meta tag (older GitHub versions)
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta?.getAttribute('content')) return meta.getAttribute('content');

  // Fallback: hidden input
  const input = document.querySelector(
    'input[name="authenticity_token"]'
  ) as HTMLInputElement | null;
  if (input?.value) return input.value;

  return null;
}

// --- Comment submission ---

async function submitComment(
  body: string,
  match: LineMatch,
  payload: GitHubPayload
): Promise<boolean> {
  const { headCommitOid } = payload;

  if (!headCommitOid) {
    throw new Error('Cannot determine commit SHA. Try reloading the page.');
  }

  console.debug('[MDR] submitComment called');

  // Primary: GraphQL via GitHub session (no token config needed)
  const csrfToken = getCSRFToken();
  console.debug('[MDR] CSRF token:', csrfToken ? 'found' : 'NOT FOUND');
  if (csrfToken) {
    try {
      const success = await submitViaGraphQL(
        body, match.filePath, match.lineNumber, headCommitOid,
        payload, csrfToken
      );
      if (success) return true;
    } catch (e) {
      console.warn('[MDR] GraphQL submission failed, trying PAT fallback:', e);
    }
  }

  // Fallback: PAT-based via background worker
  const { pat } = await chrome.storage.sync.get('pat');
  if (pat) {
    return submitViaPat(
      pat, payload.owner, payload.repo, payload.prNumber,
      body, match.filePath, match.lineNumber, headCommitOid
    );
  }

  throw new Error(
    csrfToken
      ? 'GraphQL submission failed and no PAT configured. Check the browser console for details, or add a token in the extension popup.'
      : 'No CSRF token captured yet (try performing any action on the page first, like expanding a file), and no PAT configured. Add a token in the extension popup, or interact with the page to trigger a GitHub fetch.'
  );
}

/**
 * Submit a PR review comment via GitHub's internal GraphQL endpoint.
 * Uses the session cookie (same-origin) + CSRF token from the meta tag —
 * the same mechanism GitHub's own frontend JS uses.
 */
async function submitViaGraphQL(
  body: string, path: string, line: number, commitOid: string,
  payload: GitHubPayload, csrfToken: string
): Promise<boolean> {
  // We need the PR's GraphQL node ID. If embedded payload had it, use it.
  // Otherwise, fetch it via the REST API (unauthenticated for public repos,
  // or session-cookie-based).
  let prNodeId: string | null = payload.pullRequestId || null;
  if (!prNodeId) {
    prNodeId = await fetchPRNodeId(payload.owner, payload.repo, payload.prNumber);
  }
  if (!prNodeId) {
    throw new Error('Could not determine PR GraphQL ID');
  }

  const query = `
    mutation AddPullRequestReviewComment($input: AddPullRequestReviewCommentInput!) {
      addPullRequestReviewComment(input: $input) {
        comment {
          id
        }
      }
    }
  `;

  const variables = {
    input: {
      pullRequestId: prNodeId,
      body,
      path,
      line,
      side: 'RIGHT',
      commitOID: commitOid,
    },
  };

  const resp = await fetch('https://github.com/graphql', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GraphQL HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const result = await resp.json();

  if (result.errors?.length) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join('; '));
  }

  return !!result.data?.addPullRequestReviewComment?.comment?.id;
}

/**
 * Fetch the PR's GraphQL node ID via GitHub's same-origin JSON endpoint.
 * Falls back to the public REST API.
 */
async function fetchPRNodeId(
  owner: string, repo: string, prNumber: number
): Promise<string | null> {
  // Try same-origin GitHub web endpoint
  try {
    const resp = await fetch(
      `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      const id = data?.props?.initialPayload?.pullRequest?.id
        ?? data?.payload?.pullRequest?.id;
      if (id) return id;
    }
  } catch { /* fall through */ }

  // Fallback: public REST API (works for public repos)
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.node_id) return data.node_id;
    }
  } catch { /* fall through */ }

  return null;
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
    initialize();
  }, 300);
}

// --- Bootstrap ---

installCsrfInterceptor();
initialize();
setupNavigationListeners();
