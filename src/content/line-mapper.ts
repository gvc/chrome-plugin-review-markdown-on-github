import { LineMapEntry, LineMatch } from '../shared/types';

const scrapedCache = new Map<string, string>();
const lineMapCache = new Map<string, LineMapEntry[]>();

// --- Scraping raw markdown from source diff DOM ---

/**
 * Scrape raw markdown content from the source diff table.
 * Reads td[data-line-number] cells on the right/head side (additions + context).
 * Returns null if the table isn't in the DOM (rich diff is active).
 */
export function scrapeRawFromSourceDiff(
  container: HTMLElement,
  filePath: string
): string | null {
  const cached = scrapedCache.get(filePath);
  if (cached !== undefined) return cached;

  const table = container.querySelector<HTMLElement>('table');
  if (!table) return null;

  const lines: Array<{ num: number; text: string }> = [];
  const rows = table.querySelectorAll<HTMLTableRowElement>('tr');

  for (const row of rows) {
    const numCells = row.querySelectorAll<HTMLTableCellElement>('td[data-line-number]');
    for (const numCell of numCells) {
      // Only right-side (head) lines: additions and context
      if (
        !numCell.classList.contains('blob-num-addition') &&
        !numCell.classList.contains('blob-num-context')
      ) {
        continue;
      }

      const lineNum = parseInt(numCell.getAttribute('data-line-number') ?? '', 10);
      if (isNaN(lineNum)) continue;

      // The code cell is the next sibling td, or a td with blob-code class in same row
      const codeCell =
        numCell.nextElementSibling ??
        row.querySelector<HTMLElement>('.blob-code-addition, .blob-code-context');
      if (!codeCell) continue;

      // GitHub prepends a non-printing space for diff markers — strip it
      const raw = (codeCell.textContent ?? '').replace(/^\u00a0/, '').replace(/^ /, '');
      lines.push({ num: lineNum, text: raw });
      break; // only one right-side cell per row
    }
  }

  if (lines.length === 0) return null;

  lines.sort((a, b) => a.num - b.num);

  // Build result array, filling gaps (collapsed hunks) with empty strings
  const maxLine = lines[lines.length - 1].num;
  const result = new Array<string>(maxLine).fill('');
  for (const { num, text } of lines) {
    result[num - 1] = text;
  }

  const content = result.join('\n');
  scrapedCache.set(filePath, content);
  return content;
}

export function clearScrapedCache(filePath?: string): void {
  if (filePath) {
    scrapedCache.delete(filePath);
  } else {
    scrapedCache.clear();
  }
}

// --- Building the line map ---

export function buildLineMap(rawContent: string): LineMapEntry[] {
  if (!rawContent) return [];

  const cached = lineMapCache.get(rawContent);
  if (cached) return cached;

  const lines = rawContent.split('\n');
  const entries: LineMapEntry[] = lines.map((raw, i) => ({
    lineNumber: i + 1,
    raw,
    normalized: normalize(raw),
    stripped: stripMarkdown(raw),
  }));

  lineMapCache.set(rawContent, entries);
  return entries;
}

export function normalize(text: string): string {
  return text
    .replace(/\u00A0/g, ' ')  // non-breaking space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripMarkdown(text: string): string {
  return text
    // Heading markers
    .replace(/^#{1,6}\s+/, '')
    // List markers (unordered)
    .replace(/^\s*[-*+]\s+/, '')
    // List markers (ordered)
    .replace(/^\s*\d+\.\s+/, '')
    // Images (before links to avoid partial match)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Bold/italic
    .replace(/[*_]{1,3}/g, '')
    // Inline code
    .replace(/`/g, '')
    // HTML tags
    .replace(/<[^>]+>/g, '')
    // Cleanup whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// --- Matching DOM elements to source lines ---

const BLOCK_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote > p, pre, th, td';

export function getMatchableElements(article: HTMLElement): HTMLElement[] {
  return Array.from(article.querySelectorAll<HTMLElement>(BLOCK_SELECTORS));
}

export function matchElementToLine(
  element: HTMLElement,
  lineMap: LineMapEntry[],
  filePath: string
): LineMatch | null {
  if (lineMap.length === 0) return null;

  const text = (element.textContent ?? '').trim();
  if (!text) return null;

  // Strategy 1: data-sourcepos attribute (some renderers add this)
  const sourcepos = element.getAttribute('data-sourcepos');
  if (sourcepos) {
    const match = sourcepos.match(/^(\d+):/);
    if (match) {
      return { lineNumber: parseInt(match[1], 10), confidence: 'exact', filePath };
    }
  }

  // Strategy 2: Exact normalized text match
  const normalizedText = normalize(text);
  const exactMatch = lineMap.find((e) => e.normalized === normalizedText);
  if (exactMatch) {
    return { lineNumber: exactMatch.lineNumber, confidence: 'exact', filePath };
  }

  // Strategy 3: First-line match (for multi-line rendered elements)
  const firstLine = normalize(text.split('\n')[0]);
  if (firstLine.length > 5) {
    const firstLineMatch = lineMap.find((e) => e.normalized === firstLine);
    if (firstLineMatch) {
      return { lineNumber: firstLineMatch.lineNumber, confidence: 'first-line', filePath };
    }
  }

  // Strategy 4: Stripped match (ignore markdown syntax)
  const strippedText = stripMarkdown(text);
  if (strippedText.length > 3) {
    const strippedMatch = lineMap.find((e) => e.stripped === strippedText);
    if (strippedMatch) {
      return { lineNumber: strippedMatch.lineNumber, confidence: 'stripped', filePath };
    }

    // Also try first line stripped
    const firstLineStripped = stripMarkdown(text.split('\n')[0]);
    if (firstLineStripped.length > 3) {
      const firstLineStrippedMatch = lineMap.find(
        (e) => e.stripped === firstLineStripped
      );
      if (firstLineStrippedMatch) {
        return {
          lineNumber: firstLineStrippedMatch.lineNumber,
          confidence: 'stripped',
          filePath,
        };
      }
    }
  }

  // Strategy 5: Fuzzy substring match
  if (normalizedText.length >= 24) {
    const prefix = normalizedText.slice(0, 80);
    const fuzzyMatch = lineMap.find(
      (e) =>
        e.normalized.length >= 10 &&
        (e.normalized.includes(prefix) || prefix.includes(e.normalized))
    );
    if (fuzzyMatch) {
      return { lineNumber: fuzzyMatch.lineNumber, confidence: 'fuzzy', filePath };
    }
  }

  // Strategy 6: Positional heuristic (last resort)
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(
      parent.querySelectorAll<HTMLElement>(':scope > ' + element.tagName.toLowerCase())
    );
    const index = siblings.indexOf(element);
    if (index >= 0) {
      // Find the Nth non-empty line in source that looks like this element type
      const tag = element.tagName.toLowerCase();
      const candidates = lineMap.filter((e) => {
        if (tag.match(/^h[1-6]$/)) return e.raw.match(/^#{1,6}\s/);
        if (tag === 'li') return e.raw.match(/^\s*[-*+]\s|^\s*\d+\.\s/);
        if (tag === 'p') return e.raw.trim().length > 0 && !e.raw.match(/^[#\-*+|>]/);
        return e.raw.trim().length > 0;
      });
      if (index < candidates.length) {
        return {
          lineNumber: candidates[index].lineNumber,
          confidence: 'positional',
          filePath,
        };
      }
    }
  }

  return null;
}

/**
 * Build a complete mapping for all matchable elements in an article.
 * Returns both the element-to-line map and a reverse line-to-element map.
 */
export function buildElementLineMap(
  article: HTMLElement,
  lineMap: LineMapEntry[],
  filePath: string
): {
  elementToLine: Map<HTMLElement, LineMatch>;
  lineToElement: Map<number, HTMLElement>;
} {
  const elementToLine = new Map<HTMLElement, LineMatch>();
  const lineToElement = new Map<number, HTMLElement>();
  const usedLines = new Set<number>();

  const elements = getMatchableElements(article);

  for (const el of elements) {
    const match = matchElementToLine(el, lineMap, filePath);
    if (match && !usedLines.has(match.lineNumber)) {
      elementToLine.set(el, match);
      lineToElement.set(match.lineNumber, el);
      usedLines.add(match.lineNumber);
    }
  }

  return { elementToLine, lineToElement };
}

export function clearCaches(): void {
  scrapedCache.clear();
  lineMapCache.clear();
}
