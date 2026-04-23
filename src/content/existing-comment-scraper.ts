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
  if (cached !== undefined) return cached;

  // Find the diff table — may be inside container or in a sibling element
  const table =
    container.querySelector<HTMLElement>('table') ??
    findSibling(container, (s) =>
      s.tagName === 'TABLE' ? s : s.querySelector('table')
    );

  if (!table) {
    commentCache.set(filePath, []);
    return [];
  }

  const comments: ExistingComment[] = [];

  // Primary strategy: React-based GitHub DOM (2024+)
  // Comments sit inside td cells with [data-inline-markers="true"] divs
  scrapeReactInlineMarkers(table, comments);

  // Fallback: look for [data-testid="review-thread"] anywhere in the table
  if (comments.length === 0) {
    scrapeReviewThreads(table, comments);
  }

  // Fallback: legacy DOM with .inline-comments rows
  if (comments.length === 0) {
    scrapeLegacyDom(table, comments);
  }

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
function scrapeReactInlineMarkers(table: HTMLElement, out: ExistingComment[]): void {
  const markers = table.querySelectorAll<HTMLElement>('[data-inline-markers="true"]');

  for (const marker of markers) {
    // Line number: from the parent <td data-line-number="N">
    const lineNumber = getLineNumberFromAncestorTd(marker)
      ?? getLineNumberFromThreadHeading(marker);
    if (!lineNumber) continue;

    // Each comment inside the thread
    const commentEls = marker.querySelectorAll<HTMLElement>(
      '[class*="ReviewThreadComment-module__ReviewThreadContainer"], [class*="review-thread-component"]'
    );

    if (commentEls.length > 0) {
      for (const el of commentEls) {
        const comment = extractComment(el, lineNumber);
        if (comment) out.push(comment);
      }
    } else {
      // Fallback: try the whole marker as a single comment container
      const threads = marker.querySelectorAll<HTMLElement>('[data-testid="review-thread"]');
      for (const thread of threads) {
        const comment = extractComment(thread, lineNumber);
        if (comment) out.push(comment);
      }
    }
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

    const commentEls = thread.querySelectorAll<HTMLElement>(
      '[class*="ReviewThreadComment-module__ReviewThreadContainer"]'
    );

    if (commentEls.length > 0) {
      for (const el of commentEls) {
        const comment = extractComment(el, lineNumber);
        if (comment) out.push(comment);
      }
    } else {
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

// --- Comment extraction ---

function extractComment(el: HTMLElement, lineNumber: number): ExistingComment | null {
  // Author — CSS module class with "AuthorName" or "ActivityHeader"
  const authorEl =
    el.querySelector<HTMLElement>('[class*="ActivityHeader-module__AuthorName"]') ??
    el.querySelector<HTMLElement>('[class*="AuthorName"]') ??
    el.querySelector<HTMLElement>('.author') ??
    el.querySelector<HTMLElement>('a.Link--primary');
  const author = authorEl?.textContent?.trim() ?? '';

  // Avatar — CSS module class with "activityAvatar" or "Avatar-module"
  const avatarEl =
    el.querySelector<HTMLImageElement>('[class*="Avatar-module__activityAvatar"]') ??
    el.querySelector<HTMLImageElement>('[class*="activityAvatar"]') ??
    el.querySelector<HTMLImageElement>('img.avatar, img.avatar-user');
  const avatarUrl = avatarEl?.src ?? '';

  // Body — rendered markdown in SafeHTMLBox or markdown-body
  const bodyEl =
    el.querySelector<HTMLElement>('[class*="SafeHTMLBox"]') ??
    el.querySelector<HTMLElement>('.markdown-body') ??
    el.querySelector<HTMLElement>('[class*="comment-body"]') ??
    el.querySelector<HTMLElement>('[data-testid="comment-body"]');
  const bodyHtml = bodyEl?.innerHTML?.trim() ?? '';

  // Timestamp
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
