import { DraftComment, PRKey } from '../shared/types';
import { getDrafts, deleteDraft, updateDraft } from './draft-storage';

export async function renderDraftsInSourceDiff(
  container: HTMLElement,
  filePath: string,
  prKey: PRKey,
): Promise<void> {
  const allDrafts = await getDrafts(prKey);
  const drafts = allDrafts.filter((d) => d.filePath === filePath);

  if (drafts.length === 0) {
    return;
  }

  const table = container.querySelector('table') as HTMLElement | null;
  if (!table) {
    return;
  }

  const colspan = table.querySelector('tr')?.children.length ?? 4;
  const unplaced: DraftComment[] = [];

  for (const draft of drafts) {
    const row = findSourceDiffRow(table, draft.lineNumber);
    if (row) {
      const draftRow = createDraftRow(draft, prKey, colspan);
      row.insertAdjacentElement('afterend', draftRow);
    } else {
      unplaced.push(draft);
    }
  }

  if (unplaced.length > 0) {
    const banner = createBanner(unplaced);
    container.insertAdjacentElement('afterbegin', banner);
  }
}

export function clearDraftRenderings(container: HTMLElement): void {
  container.querySelectorAll('.mdr-source-draft').forEach((el) => el.remove());
  container.querySelectorAll('.mdr-draft-banner').forEach((el) => el.remove());
}

function findSourceDiffRow(table: HTMLElement, lineNumber: number): HTMLTableRowElement | null {
  const cells = table.querySelectorAll<HTMLTableCellElement>(
    `td[data-line-number="${lineNumber}"]`,
  );

  for (const cell of cells) {
    if (
      cell.classList.contains('blob-num-addition') ||
      cell.classList.contains('blob-num-context')
    ) {
      return cell.closest('tr');
    }
  }

  if (cells.length > 0) {
    return cells[cells.length - 1].closest('tr');
  }

  return null;
}

function createDraftRow(
  draft: DraftComment,
  prKey: PRKey,
  colspan: number,
): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'mdr-source-draft';
  tr.dataset.mdrDraftId = draft.id;

  const td = document.createElement('td');
  td.colSpan = colspan;
  td.className = 'mdr-source-draft-cell';

  td.innerHTML = `
    <div class="mdr-source-draft-header">
      <span class="mdr-source-draft-label">📝 Draft on line ${draft.lineNumber}</span>
      <span class="mdr-source-draft-confidence">${confidenceBadge(draft.confidence)}</span>
    </div>
    <div class="mdr-source-draft-body">${escapeHtml(draft.body)}</div>
    <div class="mdr-source-draft-actions">
      <button class="mdr-source-draft-edit">Edit</button>
      <button class="mdr-source-draft-delete">Delete</button>
    </div>
  `;

  const deleteBtn = td.querySelector<HTMLButtonElement>('.mdr-source-draft-delete')!;
  deleteBtn.addEventListener('click', async () => {
    await deleteDraft(prKey, draft.id);
    tr.remove();
  });

  const editBtn = td.querySelector<HTMLButtonElement>('.mdr-source-draft-edit')!;
  editBtn.addEventListener('click', () => {
    const bodyEl = td.querySelector<HTMLElement>('.mdr-source-draft-body')!;
    const currentText = draft.body;

    const textarea = document.createElement('textarea');
    textarea.className = 'mdr-source-draft-textarea';
    textarea.value = currentText;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'mdr-source-draft-save';
    saveBtn.textContent = 'Save';

    saveBtn.addEventListener('click', async () => {
      const newBody = textarea.value;
      await updateDraft(prKey, draft.id, newBody);
      draft.body = newBody;
      bodyEl.textContent = '';
      bodyEl.innerHTML = escapeHtml(newBody);
      textarea.replaceWith(bodyEl);
      saveBtn.remove();
      editBtn.style.display = '';
    });

    editBtn.style.display = 'none';
    bodyEl.replaceWith(textarea);
    td.querySelector('.mdr-source-draft-actions')!.insertAdjacentElement('afterbegin', saveBtn);
  });

  tr.appendChild(td);
  return tr;
}

function createBanner(unplacedDrafts: DraftComment[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'mdr-draft-banner';
  div.textContent = `📝 ${unplacedDrafts.length} draft comment(s) on lines not visible in diff`;
  return div;
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
