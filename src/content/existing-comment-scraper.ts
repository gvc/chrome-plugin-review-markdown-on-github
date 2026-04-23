import { ExistingComment } from '../shared/types';
import { findSibling } from './rich-diff-detector';

const commentCache = new Map<string, ExistingComment[]>();

/**
 * Scrape existing inline review comments from the source diff table.
 *
 * GitHub (2024+ React DOM) renders inline comments inside <td> cells that
 * contain <div data-inline-markers="true"> wrappers.  Each comment thread
 * lives inside a [data-testid="review-thread"] and individual comments are
 * wrapped in elements whose class includes "ReviewThreadComment-module".
 *
 * Must be called while the source diff table is in the DOM.
 */
export function scrapeExistingComments(
  container: HTMLElement,
  filePath: string
): ExistingComment[] {
  const cached = commentCache.get(filePath);
  if (cached) return cached;

  // Find the diff table — may be inside container or in a sibling element
  const table =
    container.querySelector<HTMLElement>('table') ??
    findSibling(container, (s) =>
      s.tagName === 'TABLE' ? s : s.querySelector('table')
    );

  if (!table) {
    console.debug(`[MDR] Comment scraper: no table found for ${filePath}`);
    return [];
  }

  // Search scope: the table itself, but also the broader container and its
  // siblings.  GitHub's React DOM sometimes renders inline comment threads
  // outside the <table> (e.g. in a wrapper div alongside it).
  const searchRoots: HTMLElement[] = [table];
  if (table !== container) searchRoots.push(container);
  // Also check parent — comments may sit next to the table in a shared wrapper
  if (container.parentElement && container.parentElement !== document.body) {
    searchRoots.push(container.parentElement);
  }

  const comments: ExistingComment[] = [];

  // Primary strategy: React-based GitHub DOM (2024+)
  for (const root of searchRoots) {
    scrapeReactInlineMarkers(root, comments);
    if (comments.length > 0) break;
  }

  // Fallback: look for [data-testid="review-thread"]
  if (comments.length === 0) {
    for (const root of searchRoots) {
      scrapeReviewThreads(root, comments);
      if (comments.length > 0) break;
    }
  }

  // Fallback: legacy DOM with .inline-comments rows
  if (comments.length === 0) {
    scrapeLegacyDom(table, comments);
  }

  console.debug(`[MDR] Comment scraper result for ${filePath}: ${comments.length} comment(s)`);

  commentCache.set(filePath, comments);
  return comments;
}

/**
 * Primary strategy: GitHub's React DOM (2024+).
 *
 * Structure:
 *   <td data-line-number="16" class="right-side-diff-cell">
 *     ...code content...
 *     <div data-inline-markers="true">
 *       <div class="InlineMarkers-module__markersWrapper__...">
 *         <div data-first-marker="true" data-marker-id="...">
 *           <div data-testid="review-thread">
 *             <h2>Comment on line <span>R16</span></h2>
 *             <div class="...ReviewThreadComment-module__ReviewThreadContainer__...">
 *               ... author, avatar, body, timestamp ...
 *             </div>
 *           </div>
 *         </div>
 *       </div>
 *     </div>
 *   </td>
 */
function scrapeReactInlineMarkers(root: HTMLElement, out: ExistingComment[]): void {
  const markers = root.querySelectorAll<HTMLElement>('[data-inline-markers="true"]');

  for (const marker of markers) {
    const lineNumber = getLineNumberFromAncestorTd(marker)
      ?? getLineNumberFromThreadHeading(marker);
    if (!lineNumber) continue;

    // Each real comment has exactly one SafeHTMLBox / markdown-body.
    // Use leaf body elements as anchors to avoid nested-container duplication.
    const bodyEls = marker.querySelectorAll<HTMLElement>('[class*="SafeHTMLBox"], .markdown-body');
    extractLeafComments(bodyEls, lineNumber, out);
  }
}

/**
 * Fallback: find [data-testid="review-thread"] elements in the table.
 */
function scrapeReviewThreads(table: HTMLElement, out: ExistingComment[]): void {
  const threads = table.querySelectorAll<HTMLElement>('[data-testid="review-thread"]');

  for (const thread of threads) {
    const lineNumber = getLineNumberFromAncestorTd(thread)
      ?? getLineNumberFromThreadHeading(thread);
    if (!lineNumber) continue;

    const bodyEls = thread.querySelectorAll<HTMLElement>('[class*="SafeHTMLBox"], .markdown-body');
    const beforeLen = out.length;
    extractLeafComments(bodyEls, lineNumber, out);
    // If no bodies found, try the thread as a whole
    if (out.length === beforeLen) {
      const comment = extractComment(thread, lineNumber);
      if (comment) out.push(comment);
    }
  }
}

/**
 * Legacy fallback: .inline-comments rows with .review-comment elements.
 */
function scrapeLegacyDom(table: HTMLElement, out: ExistingComment[]): void {
  const commentRows = table.querySelectorAll<HTMLElement>(
    'tr.inline-comments, tr.js-inline-comments-container'
  );

  for (const row of commentRows) {
    const prevRow = row.previousElementSibling as HTMLElement | null;
    const lineNumber = prevRow ? getLineNumberFromRow(prevRow) : null;
    if (!lineNumber) continue;

    const comments = row.querySelectorAll<HTMLElement>(
      '.review-comment, .timeline-comment'
    );

    for (const el of comments) {
      const comment = extractComment(el, lineNumber);
      if (comment) out.push(comment);
    }
  }
}

// --- Line number extraction ---

function getLineNumberFromAncestorTd(el: HTMLElement): number | null {
  const td = el.closest<HTMLElement>('td[data-line-number]');
  if (td) {
    const n = parseInt(td.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }
  return null;
}

function getLineNumberFromThreadHeading(el: HTMLElement): number | null {
  // <h2>Comment on line <span>R16</span></h2>
  const headings = el.querySelectorAll<HTMLElement>('h2');
  for (const h of headings) {
    const text = h.textContent ?? '';
    const match = text.match(/line\s+R?(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function getLineNumberFromRow(row: HTMLElement): number | null {
  const cell = row.querySelector<HTMLElement>('td[data-line-number]');
  if (cell) {
    const n = parseInt(cell.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }
  return null;
}

// --- Shared extraction helpers ---

/**
 * Given a set of body elements, keep only leaf nodes (no nested matches),
 * then extract and deduplicate comments into `out`.
 */
function extractLeafComments(
  bodyEls: NodeListOf<HTMLElement>,
  lineNumber: number,
  out: ExistingComment[]
): void {
  const bodySelector = '[class*="SafeHTMLBox"], .markdown-body';
  const leafBodies: HTMLElement[] = [];
  for (const b of bodyEls) {
    if (!b.querySelector(bodySelector)) leafBodies.push(b);
  }

  const seen = new Set<string>();
  for (const body of leafBodies) {
    // Walk up to the per-comment wrapper — use ReviewThreadContainer specifically
    // to avoid hitting a shared ancestor that wraps multiple comments.
    const wrapper =
      body.closest<HTMLElement>('[class*="ReviewThreadContainer"]') ??
      body.closest<HTMLElement>('[class*="ReviewThreadComment-module"]') ??
      body.parentElement;
    if (!wrapper) continue;

    const comment = extractCommentFromWrapper(wrapper, body, lineNumber);
    if (!comment) continue;

    const key = `${lineNumber}:${comment.author}:${comment.bodyHtml.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(comment);
  }
}

/**
 * Extract a comment given its wrapper element and the already-located body element.
 * Searches the wrapper for author/avatar/timestamp metadata.
 */
function extractCommentFromWrapper(
  wrapper: HTMLElement,
  bodyEl: HTMLElement,
  lineNumber: number
): ExistingComment | null {
  const authorEl =
    wrapper.querySelector<HTMLElement>('[class*="ActivityHeader-module__AuthorName"]') ??
    wrapper.querySelector<HTMLElement>('[class*="AuthorName"]') ??
    wrapper.querySelector<HTMLElement>('.author') ??
    wrapper.querySelector<HTMLElement>('a.Link--primary');
  const author = authorEl?.textContent?.trim() ?? '';

  const avatarEl =
    wrapper.querySelector<HTMLImageElement>('[class*="Avatar-module__activityAvatar"]') ??
    wrapper.querySelector<HTMLImageElement>('[class*="activityAvatar"]') ??
    wrapper.querySelector<HTMLImageElement>('img.avatar, img.avatar-user');
  const avatarUrl = avatarEl?.src ?? '';

  const bodyHtml = bodyEl.innerHTML?.trim() ?? '';

  const timeEl = wrapper.querySelector<HTMLElement>('relative-time, time');
  const createdAt = timeEl?.getAttribute('datetime') ?? '';

  if (!bodyHtml) return null;

  return { author, avatarUrl, bodyHtml, lineNumber, createdAt };
}

/**
 * Legacy extraction — searches el for all parts.
 */
function extractComment(el: HTMLElement, lineNumber: number): ExistingComment | null {
  const authorEl =
    el.querySelector<HTMLElement>('[class*="ActivityHeader-module__AuthorName"]') ??
    el.querySelector<HTMLElement>('[class*="AuthorName"]') ??
    el.querySelector<HTMLElement>('.author') ??
    el.querySelector<HTMLElement>('a.Link--primary');
  const author = authorEl?.textContent?.trim() ?? '';

  const avatarEl =
    el.querySelector<HTMLImageElement>('[class*="Avatar-module__activityAvatar"]') ??
    el.querySelector<HTMLImageElement>('[class*="activityAvatar"]') ??
    el.querySelector<HTMLImageElement>('img.avatar, img.avatar-user');
  const avatarUrl = avatarEl?.src ?? '';

  const bodyEl =
    el.querySelector<HTMLElement>('[class*="SafeHTMLBox"]') ??
    el.querySelector<HTMLElement>('.markdown-body') ??
    el.querySelector<HTMLElement>('[class*="comment-body"]') ??
    el.querySelector<HTMLElement>('[data-testid="comment-body"]');
  const bodyHtml = bodyEl?.innerHTML?.trim() ?? '';

  const timeEl = el.querySelector<HTMLElement>('relative-time, time');
  const createdAt = timeEl?.getAttribute('datetime') ?? '';

  if (!bodyHtml) return null;

  return { author, avatarUrl, bodyHtml, lineNumber, createdAt };
}

export function clearExistingCommentCache(filePath?: string): void {
  if (filePath) {
    commentCache.delete(filePath);
  } else {
    commentCache.clear();
  }
}
