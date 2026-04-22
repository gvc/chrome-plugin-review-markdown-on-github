import { LineMatch, LineMapEntry } from '../shared/types';
import { matchElementToLine } from './line-mapper';

export type OnCommentClick = (element: HTMLElement, match: LineMatch) => void;

const HOVER_BUTTON_ID = 'mdr-hover-btn';
let hoverButton: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let currentCallback: OnCommentClick | null = null;
let currentLineMap: LineMapEntry[] | null = null;
let currentFilePath: string | null = null;

function getOrCreateHoverButton(): HTMLElement {
  if (hoverButton && document.body.contains(hoverButton)) return hoverButton;

  hoverButton = document.createElement('button');
  hoverButton.id = HOVER_BUTTON_ID;
  hoverButton.className = 'mdr-hover-btn';
  hoverButton.textContent = '+';
  hoverButton.title = 'Add review comment';
  hoverButton.style.display = 'none';

  hoverButton.addEventListener('mouseenter', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });

  hoverButton.addEventListener('mouseleave', () => {
    scheduleHide();
  });

  hoverButton.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const target = hoverButton?.dataset.targetElement;
    if (!target) return;

    const el = document.querySelector<HTMLElement>(`[data-mdr-id="${target}"]`);
    if (!el || !currentLineMap || !currentFilePath || !currentCallback) return;

    const match = matchElementToLine(el, currentLineMap, currentFilePath);
    if (match) {
      hideButton();
      currentCallback(el, match);
    }
  });

  document.body.appendChild(hoverButton);
  return hoverButton;
}

function showButton(target: HTMLElement): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  const btn = getOrCreateHoverButton();
  const rect = target.getBoundingClientRect();

  if (target.classList.contains('mdr-commented')) {
    btn.textContent = '✎';
    btn.title = 'Edit review comment';
  } else {
    btn.textContent = '+';
    btn.title = 'Add review comment';
  }

  btn.style.display = 'flex';
  btn.style.top = `${window.scrollY + rect.top + rect.height / 2 - 12}px`;
  btn.style.left = `${window.scrollX + rect.left - 32}px`;
  btn.dataset.targetElement = target.dataset.mdrId ?? '';
}

function hideButton(): void {
  if (hoverButton) {
    hoverButton.style.display = 'none';
  }
}

function scheduleHide(): void {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hideButton, 200);
}

let idCounter = 0;

export function attachClickHandlers(
  article: HTMLElement,
  lineMap: LineMapEntry[],
  filePath: string,
  onComment: OnCommentClick
): void {
  currentCallback = onComment;
  currentLineMap = lineMap;
  currentFilePath = filePath;

  const elements = article.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, li, blockquote > p, pre, th, td'
  );

  for (const el of elements) {
    if (el.dataset.mdrId) continue; // already processed

    const id = `mdr-${++idCounter}`;
    el.dataset.mdrId = id;

    el.addEventListener('mouseenter', () => {
      // Don't show on elements inside an open comment form
      if (el.closest('.mdr-comment-form')) return;
      showButton(el);
    });

    el.addEventListener('mouseleave', () => {
      scheduleHide();
    });
  }
}

export function detachClickHandlers(article: HTMLElement): void {
  // Clean up data attributes (event listeners get GC'd with elements)
  const elements = article.querySelectorAll<HTMLElement>('[data-mdr-id]');
  for (const el of elements) {
    delete el.dataset.mdrId;
  }
  hideButton();
}
