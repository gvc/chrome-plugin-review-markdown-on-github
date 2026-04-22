import { GitHubPayload, LineMatch } from '../shared/types';

export type OnSubmitComment = (
  body: string,
  match: LineMatch,
) => Promise<boolean>;

export type OnDeleteComment = (commentId: string) => Promise<void>;

let activeForm: HTMLElement | null = null;

export function showCommentForm(
  anchorElement: HTMLElement,
  match: LineMatch,
  _payload: GitHubPayload,
  onSubmit: OnSubmitComment,
  existingComment?: { id: string; body: string } | null,
  onDelete?: OnDeleteComment
): void {
  // Close any existing form
  dismissCommentForm();

  const isEdit = !!existingComment;
  const form = document.createElement('div');
  form.className = 'mdr-comment-form';

  const contextText = (anchorElement.textContent ?? '').trim();
  const truncated =
    contextText.length > 120 ? contextText.slice(0, 120) + '...' : contextText;

  const titleText = isEdit
    ? `Edit draft comment on <strong>${escapeHtml(match.filePath)}</strong> line ${match.lineNumber}`
    : `Draft comment on <strong>${escapeHtml(match.filePath)}</strong> line ${match.lineNumber}`;

  const submitLabel = isEdit ? 'Update Comment' : `Comment on Line ${match.lineNumber}`;
  const hintText = isEdit ? 'Editing queued comment' : "Opens GitHub's comment form on this line";
  const deleteButton = isEdit ? `<button class="mdr-cf-delete">Delete</button>` : '';

  form.innerHTML = `
    <div class="mdr-cf-header">
      <span class="mdr-cf-title">${titleText}</span>
      <span class="mdr-cf-confidence" title="Match confidence: ${match.confidence}">${confidenceBadge(match.confidence)}</span>
    </div>
    <div class="mdr-cf-context">${escapeHtml(truncated)}</div>
    <textarea class="mdr-cf-textarea" placeholder="Write your comment..." rows="3"></textarea>
    <div class="mdr-cf-actions">
      <span class="mdr-cf-hint">${hintText}</span>
      ${deleteButton}
      <button class="mdr-cf-cancel">Cancel</button>
      <button class="mdr-cf-submit">${submitLabel}</button>
    </div>
    <div class="mdr-cf-error" style="display:none"></div>
  `;

  // Insert after anchor
  anchorElement.insertAdjacentElement('afterend', form);
  activeForm = form;

  const textarea = form.querySelector<HTMLTextAreaElement>('.mdr-cf-textarea')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('.mdr-cf-submit')!;
  const cancelBtn = form.querySelector<HTMLButtonElement>('.mdr-cf-cancel')!;
  const errorDiv = form.querySelector<HTMLElement>('.mdr-cf-error')!;
  const deleteBtn = form.querySelector<HTMLButtonElement>('.mdr-cf-delete');

  if (isEdit && existingComment) {
    textarea.value = existingComment.body;
  }

  textarea.focus();

  // Keyboard shortcut
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSubmit();
    }
    if (e.key === 'Escape') {
      dismissCommentForm();
    }
  });

  cancelBtn.addEventListener('click', dismissCommentForm);
  submitBtn.addEventListener('click', doSubmit);

  if (deleteBtn && existingComment && onDelete) {
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      await onDelete(existingComment.id);
      dismissCommentForm();
    });
  }

  async function doSubmit(): Promise<void> {
    const body = textarea.value.trim();
    if (!body) {
      textarea.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? 'Updating...' : 'Opening...';
    errorDiv.style.display = 'none';

    try {
      const success = await onSubmit(body, match);
      if (success) {
        dismissCommentForm();
      } else {
        showError(errorDiv, 'Could not open GitHub comment form. Try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showError(errorDiv, msg);
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }
  }
}

export function dismissCommentForm(): void {
  if (activeForm) {
    activeForm.remove();
    activeForm = null;
  }
}

function showError(el: HTMLElement, msg: string): void {
  el.textContent = msg;
  el.style.display = 'block';
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

function confidenceBadge(confidence: string): string {
  switch (confidence) {
    case 'exact':
      return '<span class="mdr-badge mdr-badge-exact">exact</span>';
    case 'first-line':
    case 'stripped':
      return '<span class="mdr-badge mdr-badge-good">~matched</span>';
    case 'fuzzy':
    case 'positional':
      return '<span class="mdr-badge mdr-badge-low">~approx</span>';
    default:
      return '';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
