import { GitHubPayload, LineMatch } from '../shared/types';

export type OnSubmitComment = (
  body: string,
  match: LineMatch,
  payload: GitHubPayload
) => Promise<boolean>;

let activeForm: HTMLElement | null = null;

export function showCommentForm(
  anchorElement: HTMLElement,
  match: LineMatch,
  payload: GitHubPayload,
  onSubmit: OnSubmitComment
): void {
  // Close any existing form
  dismissCommentForm();

  const form = document.createElement('div');
  form.className = 'mdr-comment-form';

  const contextText = (anchorElement.textContent ?? '').trim();
  const truncated =
    contextText.length > 120 ? contextText.slice(0, 120) + '...' : contextText;

  form.innerHTML = `
    <div class="mdr-cf-header">
      <span class="mdr-cf-title">Comment on <strong>${escapeHtml(match.filePath)}</strong> line ${match.lineNumber}</span>
      <span class="mdr-cf-confidence" title="Match confidence: ${match.confidence}">${confidenceBadge(match.confidence)}</span>
    </div>
    <div class="mdr-cf-context">${escapeHtml(truncated)}</div>
    <textarea class="mdr-cf-textarea" placeholder="Write your comment..." rows="3"></textarea>
    <div class="mdr-cf-actions">
      <span class="mdr-cf-hint">Ctrl+Enter to submit</span>
      <button class="mdr-cf-cancel">Cancel</button>
      <button class="mdr-cf-submit">Comment</button>
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

  async function doSubmit(): Promise<void> {
    const body = textarea.value.trim();
    if (!body) {
      textarea.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorDiv.style.display = 'none';

    try {
      const success = await onSubmit(body, match, payload);
      if (success) {
        dismissCommentForm();
        showToast('Comment posted');
        // Add visual indicator to anchor
        anchorElement.classList.add('mdr-has-comment');
      } else {
        showError(errorDiv, 'Failed to post comment. Try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showError(errorDiv, msg);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Comment';
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
