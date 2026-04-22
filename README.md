# Markdown Review for GitHub PRs

A Chrome extension that lets you comment directly on rendered markdown in GitHub pull request reviews.

## The problem

When reviewing a PR that changes markdown files, GitHub offers a "rich diff" toggle that shows the beautifully rendered output. But to leave a review comment, you have to switch back to the raw source diff, find the right line, and comment there. This breaks your reading flow.

## What this does

This extension adds review commenting to the rich diff view:

- **Hover any element** (paragraph, heading, list item, code block) in the rendered markdown and a `+` button appears
- **Click to comment** -- a form opens, you type your review comment, and it gets posted as a real GitHub PR review comment tied to the correct source line
- **See existing comments** -- review comments from other reviewers show up as inline badges on the rendered markdown, expandable into full threads

Comments created this way are standard GitHub PR review comments. They show up in the PR conversation, send notifications, and work with GitHub's review approval flow.

## How it works

The core challenge is mapping rendered HTML elements back to source line numbers. The extension:

1. Extracts PR metadata from GitHub's embedded page data (commit SHA, file paths)
2. Fetches the raw markdown source for each `.md` file
3. Builds a text-matching index that maps normalized text to line numbers
4. When you click an element, matches its text content against the index using multiple strategies (exact match, stripped markdown syntax, fuzzy substring) with confidence scoring
5. Submits the comment via GitHub's session (CSRF token) -- no OAuth or token setup needed

## Setup

### Prerequisites

- Node.js 18+
- Chrome or Chromium-based browser

### Build

```bash
npm install
npm run build
```

This produces a `dist/` folder with the compiled extension.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Development

```bash
npm run dev    # Rebuild on file changes
npm test       # Run unit tests
npm run test:watch  # Tests in watch mode
```

After rebuilding, go to `chrome://extensions` and click the reload button on the extension card.

## Usage

1. Open any pull request on github.com that includes `.md` file changes
2. Go to the **Files changed** tab
3. Click **Display the rich diff** on a markdown file
4. Hover over any rendered element -- a green `+` button appears to the left
5. Click it, write your comment, submit with **Ctrl+Enter** (or click Comment)
6. The comment appears in GitHub's review UI like any other review comment

### Optional: Personal Access Token

The extension uses your GitHub browser session by default. If session-based commenting doesn't work (e.g., due to GitHub changing their internal endpoints), you can configure a GitHub Personal Access Token as a fallback:

1. Click the extension icon in Chrome's toolbar
2. Expand "API Token (optional)"
3. Paste a token with `repo` scope
4. Click Save

## Project structure

```
src/
  content/          # Content script (runs on github.com PR pages)
    index.ts        # Entry point, orchestration, comment submission
    line-mapper.ts  # Core algorithm: raw markdown -> line map -> DOM element matching
    click-handler.ts    # Hover button + click handling
    comment-form.ts     # Comment input UI
    comment-overlay.ts  # Display existing comments inline
    payload-extractor.ts  # Extract PR metadata from GitHub's page data
    rich-diff-detector.ts # Find markdown files in rich diff mode
    styles.css
  background/       # Service worker (PAT-based API fallback)
  shared/           # Types, message protocol, URL parsing
  popup/            # Extension popup (enable/disable + PAT config)
tests/              # Unit tests (vitest)
```

## Limitations

- **GitHub.com only** -- does not support GitHub Enterprise on custom domains
- **Line mapping accuracy** -- works well for headings, paragraphs, and list items. Complex content (tables with merged cells, deeply nested lists) may map with lower confidence, indicated by a badge on the comment form
- **GitHub DOM dependency** -- relies on GitHub's page structure and CSS classes. If GitHub ships major UI changes, selectors may need updating

## Tech stack

- Chrome Manifest V3
- TypeScript
- Webpack
- Vitest for testing
