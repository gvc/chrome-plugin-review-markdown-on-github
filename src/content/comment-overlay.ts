import { GitHubPayload, PRComment } from '../shared/types';

/**
 * Fetch existing PR review comments.
 * Uses GitHub's same-origin session to call the API.
 */
export async function fetchPRComments(
  payload: GitHubPayload
): Promise<PRComment[]> {
  const { owner, repo, prNumber } = payload;

  // Try the GitHub web JSON endpoint first (same-origin, cookies included)
  try {
    const resp = await fetch(
      `https://github.com/${owner}/${repo}/pull/${prNumber}/review_comments`,
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      return parseComments(data);
    }
  } catch {
    // Fall through
  }

  // Fallback: try the REST API without auth (works for public repos)
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      return parseApiComments(data);
    }
  } catch {
    // Fall through
  }

  return [];
}

function parseComments(data: unknown): PRComment[] {
  if (!Array.isArray(data)) return [];
  return data.map(mapComment).filter(Boolean) as PRComment[];
}

function parseApiComments(data: unknown): PRComment[] {
  if (!Array.isArray(data)) return [];
  return data.map(mapApiComment).filter(Boolean) as PRComment[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapComment(c: any): PRComment | null {
  if (!c || typeof c !== 'object') return null;
  return {
    id: c.id ?? 0,
    body: c.body ?? '',
    path: c.path ?? '',
    line: c.line ?? c.original_line ?? null,
    side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    user: {
      login: c.user?.login ?? c.author?.login ?? '',
      avatarUrl: c.user?.avatar_url ?? c.author?.avatarUrl ?? '',
    },
    createdAt: c.created_at ?? c.createdAt ?? '',
    updatedAt: c.updated_at ?? c.updatedAt ?? '',
    inReplyToId: c.in_reply_to_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApiComment(c: any): PRComment | null {
  if (!c || typeof c !== 'object') return null;
  return {
    id: c.id,
    body: c.body ?? '',
    path: c.path ?? '',
    line: c.line ?? c.original_line ?? null,
    side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    user: {
      login: c.user?.login ?? '',
      avatarUrl: c.user?.avatar_url ?? '',
    },
    createdAt: c.created_at ?? '',
    updatedAt: c.updated_at ?? '',
    inReplyToId: c.in_reply_to_id ?? null,
  };
}

/**
 * Render comment badges on the rendered markdown.
 * Each badge shows count of comments at that line, expandable on click.
 */
export function renderCommentBadges(
  comments: PRComment[],
  filePath: string,
  lineToElement: Map<number, HTMLElement>
): void {
  // Group comments by line
  const fileComments = comments.filter((c) => c.path === filePath && c.line != null);
  const byLine = new Map<number, PRComment[]>();

  for (const c of fileComments) {
    const line = c.line!;
    const existing = byLine.get(line) ?? [];
    existing.push(c);
    byLine.set(line, existing);
  }

  for (const [line, lineComments] of byLine) {
    const el = lineToElement.get(line);
    if (!el) continue;

    // Don't duplicate badges
    if (el.querySelector('.mdr-comment-badge')) continue;

    const badge = document.createElement('span');
    badge.className = 'mdr-comment-badge';
    badge.textContent = `💬 ${lineComments.length}`;
    badge.title = `${lineComments.length} comment(s) on line ${line}`;

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCommentThread(el, lineComments);
    });

    el.style.position = 'relative';
    el.appendChild(badge);
  }
}

function toggleCommentThread(anchor: HTMLElement, comments: PRComment[]): void {
  const existing = anchor.nextElementSibling;
  if (existing?.classList.contains('mdr-comment-thread')) {
    existing.remove();
    return;
  }

  const thread = document.createElement('div');
  thread.className = 'mdr-comment-thread';

  // Sort: original comment first, replies after
  const sorted = [...comments].sort((a, b) => {
    if (a.inReplyToId === null && b.inReplyToId !== null) return -1;
    if (a.inReplyToId !== null && b.inReplyToId === null) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const c of sorted) {
    const item = document.createElement('div');
    item.className = 'mdr-comment-item';

    const ago = timeAgo(c.createdAt);
    item.innerHTML = `
      <div class="mdr-comment-meta">
        ${c.user.avatarUrl ? `<img class="mdr-avatar" src="${escapeAttr(c.user.avatarUrl)}" width="20" height="20">` : ''}
        <strong>${escapeHtml(c.user.login)}</strong>
        <span class="mdr-comment-time">${ago}</span>
      </div>
      <div class="mdr-comment-body">${escapeHtml(c.body)}</div>
    `;
    thread.appendChild(item);
  }

  anchor.insertAdjacentElement('afterend', thread);
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
