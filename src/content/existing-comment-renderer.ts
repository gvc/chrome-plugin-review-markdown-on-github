import { ExistingComment } from '../shared/types';

/**
 * Render existing PR review comments below their matching rich-diff elements.
 * Comments are read-only — they reflect what's already on the PR.
 */
export function renderExistingComments(
  comments: ExistingComment[],
  lineToElement: Map<number, HTMLElement>
): void {
  // Group comments by line number (multiple comments can exist on same line)
  const byLine = new Map<number, ExistingComment[]>();
  for (const c of comments) {
    const arr = byLine.get(c.lineNumber) ?? [];
    arr.push(c);
    byLine.set(c.lineNumber, arr);
  }

  for (const [lineNumber, lineComments] of byLine) {
    const element = lineToElement.get(lineNumber);
    if (!element) continue;

    // Don't double-render
    if (element.nextElementSibling?.classList.contains('mdr-existing-comments')) {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'mdr-existing-comments';

    for (const comment of lineComments) {
      wrapper.appendChild(buildCommentBubble(comment));
    }

    element.insertAdjacentElement('afterend', wrapper);
  }
}

function buildCommentBubble(comment: ExistingComment): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = 'mdr-ec-bubble';

  const header = document.createElement('div');
  header.className = 'mdr-ec-header';

  if (comment.avatarUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'mdr-ec-avatar';
    avatar.src = comment.avatarUrl;
    avatar.alt = comment.author;
    avatar.width = 20;
    avatar.height = 20;
    header.appendChild(avatar);
  }

  if (comment.author) {
    const authorSpan = document.createElement('strong');
    authorSpan.className = 'mdr-ec-author';
    authorSpan.textContent = comment.author;
    header.appendChild(authorSpan);
  }

  if (comment.createdAt) {
    const timeSpan = document.createElement('span');
    timeSpan.className = 'mdr-ec-time';
    timeSpan.textContent = formatRelativeTime(comment.createdAt);
    timeSpan.title = comment.createdAt;
    header.appendChild(timeSpan);
  }

  const body = document.createElement('div');
  body.className = 'mdr-ec-body markdown-body';
  body.innerHTML = comment.bodyHtml;

  bubble.appendChild(header);
  bubble.appendChild(body);
  return bubble;
}

function formatRelativeTime(isoDate: string): string {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

/**
 * Remove all rendered existing comments from the article.
 * Called before re-rendering (e.g. on toggle back to rich diff).
 */
export function clearRenderedComments(article: HTMLElement): void {
  const wrappers = article.querySelectorAll('.mdr-existing-comments');
  for (const w of wrappers) w.remove();
}
