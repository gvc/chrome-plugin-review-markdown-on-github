import type { PersistedComment } from '../shared/types';

export type OnPanelUpdate = (id: string, filePath: string, newBody: string) => Promise<void>;
export type OnPanelDelete = (id: string, filePath: string) => Promise<void>;
export type OnPanelClose = () => void;

const PANEL_ID = 'mdr-panel';
const BUTTON_ID = 'mdr-panel-btn';

let panelEl: HTMLElement | null = null;
let buttonEl: HTMLElement | null = null;
let isPanelOpen = false;

// Callbacks set by the host
let onUpdate: OnPanelUpdate | null = null;
let onDelete: OnPanelDelete | null = null;

// --- MDR floating button ---

export function createMdrButton(
  onOpen: () => void,
  onClose: OnPanelClose
): HTMLElement {
  if (buttonEl && document.body.contains(buttonEl)) return buttonEl;

  buttonEl = document.createElement('button');
  buttonEl.id = BUTTON_ID;
  buttonEl.className = 'mdr-panel-btn';
  buttonEl.title = 'Show queued comments (MDR)';
  buttonEl.setAttribute('aria-label', 'Show queued comments');
  buttonEl.innerHTML = `<span class="mdr-panel-btn-label">MDR</span><span class="mdr-panel-btn-badge" style="display:none">0</span>`;

  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPanelOpen) {
      closePanel();
      onClose();
    } else {
      onOpen();
    }
  });

  document.body.appendChild(buttonEl);
  return buttonEl;
}

export function removeMdrButton(): void {
  buttonEl?.remove();
  buttonEl = null;
}

export function updateMdrButtonBadge(count: number): void {
  const badge = buttonEl?.querySelector<HTMLElement>('.mdr-panel-btn-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = String(count);
    badge.style.display = 'inline-flex';
    buttonEl?.classList.add('mdr-panel-btn--has-comments');
  } else {
    badge.style.display = 'none';
    buttonEl?.classList.remove('mdr-panel-btn--has-comments');
  }
}

// --- Panel ---

export function openPanel(
  allQueued: Map<string, PersistedComment[]>,
  handlers: { onUpdate: OnPanelUpdate; onDelete: OnPanelDelete }
): void {
  onUpdate = handlers.onUpdate;
  onDelete = handlers.onDelete;

  closePanel(); // reset stale state

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'mdr-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Queued review comments');

  const allComments: PersistedComment[] = [];
  for (const list of allQueued.values()) allComments.push(...list);
  allComments.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);

  panel.innerHTML = buildPanelHTML(allComments);
  document.body.appendChild(panel);
  panelEl = panel;
  isPanelOpen = true;
  buttonEl?.classList.add('mdr-panel-btn--active');

  attachPanelEvents(panel, allComments);

  // Close on backdrop click
  document.addEventListener('mousedown', onBackdropClick, { capture: true });
  document.addEventListener('keydown', onEscape);
}

export function closePanel(): void {
  panelEl?.remove();
  panelEl = null;
  isPanelOpen = false;
  buttonEl?.classList.remove('mdr-panel-btn--active');
  document.removeEventListener('mousedown', onBackdropClick, { capture: true });
  document.removeEventListener('keydown', onEscape);
}

export function isPanelVisible(): boolean {
  return isPanelOpen;
}

// --- Internal ---

function buildPanelHTML(comments: PersistedComment[]): string {
  const empty = comments.length === 0
    ? `<div class="mdr-panel-empty">No queued comments yet.<br>Hover elements in the rich diff and click <strong>+</strong> to add one.</div>`
    : '';

  const items = comments.map((c) => buildItemHTML(c)).join('');

  return `
    <div class="mdr-panel-header">
      <span class="mdr-panel-title">Queued Comments${comments.length > 0 ? ` <span class="mdr-panel-count">${comments.length}</span>` : ''}</span>
      <button class="mdr-panel-close" aria-label="Close panel">✕</button>
    </div>
    <div class="mdr-panel-body">
      ${empty}
      ${items}
    </div>
    ${comments.length > 0 ? `<div class="mdr-panel-footer">Switch to Source diff to post all comments.</div>` : ''}
  `;
}

function buildItemHTML(c: PersistedComment): string {
  const shortFile = c.filePath.split('/').pop() ?? c.filePath;
  const escaped = escapeHtml(c.body);
  return `
    <div class="mdr-panel-item" data-comment-id="${c.id}" data-file-path="${escapeHtml(c.filePath)}">
      <div class="mdr-panel-item-meta">
        <span class="mdr-panel-item-file" title="${escapeHtml(c.filePath)}">${escapeHtml(shortFile)}</span>
        <span class="mdr-panel-item-line">line ${c.lineNumber}</span>
        <div class="mdr-panel-item-actions">
          <button class="mdr-panel-edit-btn" title="Edit comment">✎</button>
          <button class="mdr-panel-delete-btn" title="Remove comment">✕</button>
        </div>
      </div>
      <div class="mdr-panel-item-body">${escaped}</div>
      <div class="mdr-panel-item-edit" style="display:none">
        <textarea class="mdr-panel-item-textarea" rows="3">${escaped}</textarea>
        <div class="mdr-panel-item-edit-actions">
          <button class="mdr-panel-save-btn">Save</button>
          <button class="mdr-panel-cancel-edit-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function attachPanelEvents(panel: HTMLElement, comments: PersistedComment[]): void {
  // Close button
  panel.querySelector('.mdr-panel-close')?.addEventListener('click', () => closePanel());

  // Per-item buttons
  for (const item of panel.querySelectorAll<HTMLElement>('.mdr-panel-item')) {
    const id = item.dataset.commentId!;
    const filePath = item.dataset.filePath!;
    const comment = comments.find((c) => c.id === id);
    if (!comment) continue;

    const bodyEl = item.querySelector<HTMLElement>('.mdr-panel-item-body')!;
    const editEl = item.querySelector<HTMLElement>('.mdr-panel-item-edit')!;
    const textarea = item.querySelector<HTMLTextAreaElement>('.mdr-panel-item-textarea')!;

    // Edit
    item.querySelector('.mdr-panel-edit-btn')?.addEventListener('click', () => {
      bodyEl.style.display = 'none';
      editEl.style.display = 'block';
      textarea.value = comment.body;
      textarea.focus();
    });

    // Cancel edit
    item.querySelector('.mdr-panel-cancel-edit-btn')?.addEventListener('click', () => {
      editEl.style.display = 'none';
      bodyEl.style.display = 'block';
    });

    // Save edit
    item.querySelector('.mdr-panel-save-btn')?.addEventListener('click', async () => {
      const newBody = textarea.value.trim();
      if (!newBody) return;
      const saveBtn = item.querySelector<HTMLButtonElement>('.mdr-panel-save-btn')!;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      await onUpdate?.(id, filePath, newBody);
      comment.body = newBody;
      bodyEl.textContent = newBody;
      editEl.style.display = 'none';
      bodyEl.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    });

    // Keyboard shortcut in textarea
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        (item.querySelector('.mdr-panel-save-btn') as HTMLButtonElement)?.click();
      }
      if (e.key === 'Escape') {
        (item.querySelector('.mdr-panel-cancel-edit-btn') as HTMLButtonElement)?.click();
      }
    });

    // Delete
    item.querySelector('.mdr-panel-delete-btn')?.addEventListener('click', async () => {
      const deleteBtn = item.querySelector<HTMLButtonElement>('.mdr-panel-delete-btn')!;
      deleteBtn.disabled = true;
      await onDelete?.(id, filePath);
      item.remove();
      // Update count or show empty state
      const remaining = panelEl?.querySelectorAll('.mdr-panel-item').length ?? 0;
      updatePanelCount(remaining);
    });
  }
}

function updatePanelCount(count: number): void {
  if (!panelEl) return;
  const countEl = panelEl.querySelector<HTMLElement>('.mdr-panel-count');
  const bodyEl = panelEl.querySelector<HTMLElement>('.mdr-panel-body');
  const footerEl = panelEl.querySelector<HTMLElement>('.mdr-panel-footer');
  const titleEl = panelEl.querySelector<HTMLElement>('.mdr-panel-title');

  if (count === 0) {
    if (countEl) countEl.remove();
    if (bodyEl) bodyEl.innerHTML = `<div class="mdr-panel-empty">No queued comments yet.<br>Hover elements in the rich diff and click <strong>+</strong> to add one.</div>`;
    if (footerEl) footerEl.remove();
    if (titleEl) titleEl.textContent = 'Queued Comments';
  } else {
    if (countEl) countEl.textContent = String(count);
  }
}

function onBackdropClick(e: MouseEvent): void {
  if (!panelEl || !buttonEl) return;
  const target = e.target as Node;
  if (!panelEl.contains(target) && !buttonEl.contains(target)) {
    closePanel();
  }
}

function onEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePanel();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
