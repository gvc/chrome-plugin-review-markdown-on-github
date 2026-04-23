# Markdown Review for GitHub PRs

A Chrome extension that lets you comment directly on rendered markdown in GitHub pull request reviews.

## The problem

When reviewing a PR that changes markdown files, GitHub offers a "rich diff" toggle that shows the beautifully rendered output. But to leave a review comment, you have to switch back to the raw source diff, find the right line, and comment there. This breaks your reading flow.

## What this does

This extension adds review commenting to the rich diff view:

- **Hover any element** (paragraph, heading, list item, code block) in the rendered markdown and a `+` button appears
- **Click to comment** — a form opens, you type your review comment, and it gets queued
- **Switch to source diff** — queued comments auto-post to the correct lines via GitHub's native comment UI
- **See existing comments** — review comments from other reviewers show up as inline badges on the rendered markdown, expandable into full threads

Comments created this way are standard GitHub PR review comments. They show up in the PR conversation, send notifications, and work with GitHub's review approval flow.

## How it works

The core challenge is mapping rendered HTML elements back to source line numbers. The extension:

1. Extracts PR metadata from GitHub's embedded page data (commit SHA, file paths)
2. Auto-toggles to source diff to scrape the raw markdown source, then toggles back — no manual priming needed
3. Builds a text-matching index that maps normalized text to line numbers
4. When you click an element, matches its text content against the index using multiple strategies (exact match, stripped markdown syntax, fuzzy substring) with confidence scoring
5. Queues the comment locally (persisted to `chrome.storage.local`) with a toast notification
6. When you switch to the source diff, queued comments are flushed automatically via GitHub's native comment trigger

## How to Use

1. Open any pull request on github.com that includes `.md` file changes
2. Go to the **Files changed** tab
3. Click **Display the rich diff** on a markdown file — the extension primes itself automatically
4. Hover over any rendered element — a green `+` button appears to the left
5. Click it, write your comment, and submit with **Ctrl+Enter** (or click **Comment**)
6. A toast shows how many comments are queued
7. Switch to **Source diff** — queued comments post automatically via GitHub's native UI

### Editing or removing a queued comment

Click the `+` button on an already-commented element (shown with a visual indicator) to reopen the form. You can update the text or delete the comment from the queue before posting.

### Existing review comments

Comments already posted on the PR appear as inline badges on the rendered elements. Elements with existing comments cannot receive new ones (to avoid duplicates).

### Enable / disable

Click the extension icon in Chrome's toolbar to toggle the extension on or off. No token or login needed — the extension uses GitHub's native comment UI and requires no credentials.

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

## Project structure

```
src/
  content/              # Content script (runs on github.com PR pages)
    index.ts            # Entry point, orchestration, comment queue flush
    line-mapper.ts      # Core algorithm: raw markdown → line map → DOM element matching
    click-handler.ts    # Hover button + click handling
    comment-form.ts     # Comment input UI
    comment-queue.ts    # In-memory queue backed by chrome.storage.local
    comment-store.ts    # Persistence layer (chrome.storage.local)
    existing-comment-renderer.ts  # Render existing PR comments as inline badges
    existing-comment-scraper.ts   # Scrape existing review comments from source diff DOM
    native-comment-trigger.ts     # Trigger GitHub's native comment form on a source line
    payload-extractor.ts          # Extract PR metadata from GitHub's page data
    rich-diff-detector.ts         # Find markdown files, detect rich/source diff state
    styles.css
  shared/               # Types, message protocol, URL parsing
  popup/                # Extension popup (enable/disable toggle)
tests/                  # Unit tests (vitest)
```

## Limitations

- **GitHub.com only** — does not support GitHub Enterprise on custom domains
- **Line mapping accuracy** — works well for headings, paragraphs, and list items. Complex content (tables with merged cells, deeply nested lists) may map with lower confidence, indicated by a badge on the comment form
- **GitHub DOM dependency** — relies on GitHub's page structure and CSS classes. If GitHub ships major UI changes, selectors may need updating
- **One comment per line** — only one queued comment per source line; re-clicking updates it in place

## Tech stack

- Chrome Manifest V3
- TypeScript
- Webpack
- Vitest for testing
