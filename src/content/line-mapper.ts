import { GitHubPayload, LineMapEntry, LineMatch } from '../shared/types';

const rawCache = new Map<string, string>();
const lineMapCache = new Map<string, LineMapEntry[]>();

// --- Fetching raw markdown ---

export async function fetchRawMarkdown(
  filePath: string,
  payload: GitHubPayload
): Promise<string> {
  const cached = rawCache.get(filePath);
  if (cached !== undefined) return cached;

  const urls = buildRawUrls(filePath, payload);

  for (const url of urls) {
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.ok) {
        const text = await resp.text();
        rawCache.set(filePath, text);
        return text;
      }
    } catch {
      // Try next URL
    }
  }

  rawCache.set(filePath, '');
  return '';
}

function buildRawUrls(filePath: string, payload: GitHubPayload): string[] {
  const urls: string[] = [];

  // From embedded payload's diff entries
  const entry = payload.diffEntries.find((e) => e.path === filePath);
  if (entry?.rawBlobUrl) {
    urls.push(entry.rawBlobUrl);
  }

  // Construct from known data
  if (payload.headCommitOid) {
    urls.push(
      `https://github.com/${payload.owner}/${payload.repo}/raw/${payload.headCommitOid}/${filePath}`
    );
  }

  // Fallback: blob URL pattern
  urls.push(
    `https://github.com/${payload.owner}/${payload.repo}/raw/HEAD/${filePath}`
  );

  return urls;
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
  rawCache.clear();
  lineMapCache.clear();
}
