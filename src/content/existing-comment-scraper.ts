import { ExistingComment } from '../shared/types';
import { findSibling } from './rich-diff-detector';

const commentCache = new Map<string, ExistingComment[]>();

/**
 * Scrape existing inline review comments from the source diff table.
 *
 * GitHub renders comments as special rows/elements after the code line
 * they reference. We walk the table looking for comment thread containers
 * and extract author, avatar, HTML body, and the line number from the
 * preceding code row.
 *
 * Must be called while the source diff table is in the DOM.
 */
export function scrapeExistingComments(
  container: HTMLElement,
  filePath: string
): ExistingComment[] {
  const cached = commentCache.get(filePath);
  if (cached !== undefined) return cached;

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

  // Strategy 1: New GitHub DOM (2024+)
  // Comment threads sit in rows with td that contain .js-comments-holder
  // or in elements with [data-line-comment-thread] / .inline-comment-thread
  scrapeNewDom(table, comments);

  // Strategy 2: Legacy GitHub DOM
  // Comments live in .js-inline-comments-container or .inline-comments rows
  if (comments.length === 0) {
    scrapeLegacyDom(table, comments);
  }

  // Strategy 3: React-based diff (newest GitHub)
  // Comments appear in elements within the diff that have comment-like structure
  if (comments.length === 0) {
    scrapeReactDom(container, comments);
  }

  commentCache.set(filePath, comments);
  return comments;
}

function scrapeNewDom(table: HTMLElement, out: ExistingComment[]): void {
  // New GitHub: comment threads appear in rows after code rows.
  // Look for elements containing review comment markup.
  const commentHolders = table.querySelectorAll<HTMLElement>(
    '.js-comments-holder, .js-inline-comments-container, [data-morpheus-enabled]'
  );

  for (const holder of commentHolders) {
    const lineNumber = findLineNumberForCommentHolder(holder);
    if (!lineNumber) continue;

    const threads = holder.querySelectorAll<HTMLElement>(
      '.review-comment, .timeline-comment, [data-testid="comment-body"]'
    );

    for (const thread of threads) {
      const comment = extractCommentFromElement(thread, lineNumber);
      if (comment) out.push(comment);
    }

    // If no structured comments found, try extracting from the holder directly
    if (threads.length === 0) {
      const comment = extractCommentFromElement(holder, lineNumber);
      if (comment) out.push(comment);
    }
  }
}

function scrapeLegacyDom(table: HTMLElement, out: ExistingComment[]): void {
  // Legacy: .inline-comments rows contain .review-comment elements
  const commentRows = table.querySelectorAll<HTMLElement>(
    'tr.inline-comments, tr.js-inline-comments-container'
  );

  for (const row of commentRows) {
    // Line number from the preceding code row
    const prevRow = row.previousElementSibling as HTMLElement | null;
    const lineNumber = prevRow ? getLineNumberFromRow(prevRow) : null;
    if (!lineNumber) continue;

    const comments = row.querySelectorAll<HTMLElement>(
      '.review-comment, .timeline-comment'
    );

    for (const el of comments) {
      const comment = extractCommentFromElement(el, lineNumber);
      if (comment) out.push(comment);
    }
  }
}

function scrapeReactDom(container: HTMLElement, out: ExistingComment[]): void {
  // Newest React diff: comments may be in a sibling or nested structure
  // Look for comment containers near the diff table
  const commentContainers = container.querySelectorAll<HTMLElement>(
    '[data-line-comment], [class*="InlineComment"], [class*="review-thread"]'
  );

  for (const el of commentContainers) {
    // Try to find line number from nearby elements
    const lineAttr = el.closest<HTMLElement>('[data-line-number]');
    const lineNumber = lineAttr
      ? parseInt(lineAttr.getAttribute('data-line-number') ?? '', 10)
      : null;
    if (!lineNumber) continue;

    const comment = extractCommentFromElement(el, lineNumber);
    if (comment) out.push(comment);
  }
}

/**
 * Walk upward/backward from a comment holder to find the associated line number.
 */
function findLineNumberForCommentHolder(holder: HTMLElement): number | null {
  // Check if holder itself has a line number
  const directLine = holder.closest<HTMLElement>('[data-line-number]');
  if (directLine) {
    const n = parseInt(directLine.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }

  // Check the closest <tr>, then walk to previous sibling rows
  const row = holder.closest('tr');
  if (row) {
    const lineNum = getLineNumberFromRow(row as HTMLElement);
    if (lineNum) return lineNum;

    // Walk backward through sibling rows to find the code row
    let prev = row.previousElementSibling as HTMLElement | null;
    while (prev) {
      const n = getLineNumberFromRow(prev);
      if (n) return n;
      prev = prev.previousElementSibling as HTMLElement | null;
    }
  }

  return null;
}

function getLineNumberFromRow(row: HTMLElement): number | null {
  // New DOM
  const newCell = row.querySelector<HTMLElement>(
    'td.new-diff-line-number[data-line-number]'
  );
  if (newCell) {
    const n = parseInt(newCell.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }

  // Legacy DOM
  const oldCell = row.querySelector<HTMLElement>(
    'td.blob-num-addition[data-line-number], td.blob-num-context[data-line-number]'
  );
  if (oldCell) {
    const n = parseInt(oldCell.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }

  // Any td with data-line-number
  const anyCell = row.querySelector<HTMLElement>('td[data-line-number]');
  if (anyCell) {
    const n = parseInt(anyCell.getAttribute('data-line-number') ?? '', 10);
    if (n > 0) return n;
  }

  return null;
}

/**
 * Extract a single comment from a DOM element.
 */
function extractCommentFromElement(
  el: HTMLElement,
  lineNumber: number
): ExistingComment | null {
  // Author: look for common author selectors
  const authorEl =
    el.querySelector<HTMLElement>('.author, [data-testid="author"], a.Link--primary') ??
    el.querySelector<HTMLElement>('.timeline-comment-header a, .comment-header a');
  const author = authorEl?.textContent?.trim() ?? '';

  // Avatar
  const avatarEl = el.querySelector<HTMLImageElement>(
    'img.avatar, img[data-testid="avatar"], img.avatar-user'
  );
  const avatarUrl = avatarEl?.src ?? '';

  // Body: prefer rendered markdown body
  const bodyEl =
    el.querySelector<HTMLElement>('.comment-body, .review-comment-body, .markdown-body, [data-testid="comment-body"]') ??
    el.querySelector<HTMLElement>('.edit-comment-hide');
  const bodyHtml = bodyEl?.innerHTML?.trim() ?? '';

  // Timestamp
  const timeEl = el.querySelector<HTMLElement>('relative-time, time');
  const createdAt = timeEl?.getAttribute('datetime') ?? '';

  // Skip if no meaningful body content
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
