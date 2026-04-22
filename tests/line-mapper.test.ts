import { describe, it, expect } from 'vitest';
import {
  normalize,
  stripMarkdown,
  buildLineMap,
  matchElementToLine,
} from '../src/content/line-mapper';

describe('normalize', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalize('  Hello   World  ')).toBe('hello world');
  });

  it('replaces non-breaking spaces', () => {
    expect(normalize('hello\u00A0world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });
});

describe('stripMarkdown', () => {
  it('removes heading markers', () => {
    expect(stripMarkdown('## My Heading')).toBe('my heading');
    expect(stripMarkdown('# Title')).toBe('title');
    expect(stripMarkdown('###### Deep')).toBe('deep');
  });

  it('removes unordered list markers', () => {
    expect(stripMarkdown('- Item one')).toBe('item one');
    expect(stripMarkdown('* Item two')).toBe('item two');
    expect(stripMarkdown('+ Item three')).toBe('item three');
  });

  it('removes ordered list markers', () => {
    expect(stripMarkdown('1. First')).toBe('first');
    expect(stripMarkdown('99. Ninety ninth')).toBe('ninety ninth');
  });

  it('removes bold/italic markers', () => {
    expect(stripMarkdown('**bold** and *italic*')).toBe('bold and italic');
    expect(stripMarkdown('__bold__ and _italic_')).toBe('bold and italic');
    expect(stripMarkdown('***both***')).toBe('both');
  });

  it('removes inline code backticks', () => {
    expect(stripMarkdown('use `const` here')).toBe('use const here');
  });

  it('extracts link text', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here');
  });

  it('extracts image alt text', () => {
    expect(stripMarkdown('![alt text](image.png)')).toBe('alt text');
  });

  it('removes HTML tags', () => {
    expect(stripMarkdown('<strong>bold</strong>')).toBe('bold');
    expect(stripMarkdown('<br>')).toBe('');
  });

  it('handles complex markdown', () => {
    expect(
      stripMarkdown('## [API Docs](https://api.com) - **v2** release')
    ).toBe('api docs - v2 release');
  });
});

describe('buildLineMap', () => {
  it('builds entries for each line', () => {
    const raw = '# Title\n\nSome paragraph.\n- Item 1\n- Item 2';
    const map = buildLineMap(raw);

    expect(map).toHaveLength(5);
    expect(map[0]).toEqual({
      lineNumber: 1,
      raw: '# Title',
      normalized: '# title',
      stripped: 'title',
    });
    expect(map[2]).toEqual({
      lineNumber: 3,
      raw: 'Some paragraph.',
      normalized: 'some paragraph.',
      stripped: 'some paragraph.',
    });
  });

  it('returns empty array for empty content', () => {
    expect(buildLineMap('')).toEqual([]);
  });
});

describe('matchElementToLine', () => {
  const sampleMarkdown = [
    '# Getting Started',
    '',
    'This is a paragraph about getting started.',
    '',
    '## Installation',
    '',
    '- Run npm install',
    '- Run npm start',
    '',
    '**Bold text** with [a link](https://example.com).',
  ].join('\n');

  const lineMap = buildLineMap(sampleMarkdown);

  function mockElement(text: string, tag = 'P'): HTMLElement {
    return {
      textContent: text,
      tagName: tag,
      getAttribute: () => null,
      parentElement: null,
    } as unknown as HTMLElement;
  }

  it('matches exact normalized text', () => {
    const el = mockElement('This is a paragraph about getting started.');
    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 3,
      confidence: 'exact',
      filePath: 'README.md',
    });
  });

  it('matches heading text (stripped)', () => {
    // Rendered heading won't include the # markers
    const el = mockElement('Getting Started', 'H1');
    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 1,
      confidence: 'stripped',
      filePath: 'README.md',
    });
  });

  it('matches heading text for h2', () => {
    const el = mockElement('Installation', 'H2');
    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 5,
      confidence: 'stripped',
      filePath: 'README.md',
    });
  });

  it('matches list item text (stripped)', () => {
    const el = mockElement('Run npm install', 'LI');
    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 7,
      confidence: 'stripped',
      filePath: 'README.md',
    });
  });

  it('matches text with markdown formatting stripped', () => {
    const el = mockElement('Bold text with a link.');
    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 10,
      confidence: 'stripped',
      filePath: 'README.md',
    });
  });

  it('returns null for empty text', () => {
    const el = mockElement('');
    expect(matchElementToLine(el, lineMap, 'README.md')).toBeNull();
  });

  it('returns null for unmatched text', () => {
    const el = mockElement('This text does not exist in the document at all.');
    expect(matchElementToLine(el, lineMap, 'README.md')).toBeNull();
  });

  it('uses data-sourcepos when available', () => {
    const el = {
      textContent: 'whatever',
      tagName: 'P',
      getAttribute: (name: string) => name === 'data-sourcepos' ? '7:1-7:20' : null,
      parentElement: null,
    } as unknown as HTMLElement;

    const result = matchElementToLine(el, lineMap, 'README.md');
    expect(result).toEqual({
      lineNumber: 7,
      confidence: 'exact',
      filePath: 'README.md',
    });
  });
});
