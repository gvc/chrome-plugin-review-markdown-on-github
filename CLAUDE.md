# MDR — Markdown Review for GitHub PRs

Chrome extension (MV3) that lets reviewers comment on GitHub's rendered markdown rich diff without toggling to source diff.

## Stack

- TypeScript + Webpack (no framework)
- Vitest for unit tests
- Chrome Extension Manifest V3
- No runtime dependencies — devDeps only

## Commands

```bash
npm run dev        # webpack --watch (development)
npm run build      # webpack production build
npm run test       # vitest run (single pass)
npm run test:watch # vitest watch mode
```

After building, reload the extension manually in `chrome://extensions`.

## Architecture

### Entry points (Webpack bundles)
- `src/content/index.ts` → `dist/content/index.js` — injected on PR `/files` and `/changes` pages
- `src/background/index.ts` → `dist/background/index.js`
- `src/popup/popup.ts` → `dist/popup/popup.js`

### Content script modules (`src/content/`)

| File | Responsibility |
|---|---|
| `index.ts` | Bootstrap, SPA navigation, orchestration |
| `rich-diff-detector.ts` | Detect rich/source diff state, toggle programmatically |
| `line-mapper.ts` | Scrape raw markdown from source diff; map rendered elements to line numbers |
| `click-handler.ts` | Attach hover buttons to rendered elements |
| `comment-form.ts` | Inline comment compose UI |
| `comment-queue.ts` | In-memory + persisted queue of comments awaiting posting |
| `comment-store.ts` | `chrome.storage.local` persistence layer for queued comments |
| `comment-panel.ts` | Floating MDR button + queued comments side panel |
| `native-comment-trigger.ts` | Triggers GitHub's native comment form on source diff lines |
| `existing-comment-scraper.ts` | Scrapes existing PR review comments from source diff DOM |
| `existing-comment-renderer.ts` | Renders scraped comments onto rich diff elements |
| `payload-extractor.ts` | Extracts PR metadata (owner, repo, PR#, commit OIDs) from page |

### Shared (`src/shared/`)
- `types.ts` — all shared interfaces (`GitHubPayload`, `LineMatch`, `PersistedComment`, etc.)
- `url-parser.ts` — PR URL parsing
- `messages.ts` — content↔background messaging types

## Core flow

1. **Init**: extract PR payload → restore persisted queue → create MDR floating button
2. **Per-file**: detect rich/source diff state
   - Rich diff active on load → programmatically switch to source, scrape raw markdown + existing comments, switch back
   - Source diff active → scrape immediately; watch for lazy-loaded tables via `MutationObserver`
3. **Rich diff toggled on**: build line map → map DOM elements to line numbers → render existing comments → attach click handlers
4. **User clicks element**: show inline comment form → on submit, enqueue comment → show queued count on MDR button
5. **User toggles to source diff**: flush queue → `native-comment-trigger` opens GitHub's native form per queued line → on success, dequeue
6. **SPA navigation**: `turbo:load` / `popstate` / DOM mutation → debounced reinitialize (queue never cleared)

## Key design decisions

- **Queue-then-flush**: comments are queued in rich diff, posted via GitHub's native form when source diff is visible. No GitHub API calls for comment submission.
- **Programmatic toggle**: on load, MDR silently switches to source diff to scrape, then back — users never see this.
- **300ms debounce** on rich/source diff toggle observer — GitHub's React DOM fires many mutations mid-transition.
- **Lazy-load handling**: files below the fold have no diff table initially; `MutationObserver` watches for table insertion.
- **Persist across navigation**: `chrome.storage.local` keeps queued comments; stale entries purged after 7 days.

## GitHub DOM — IMPORTANT

**Do not search the web or assume GitHub's DOM structure.** GitHub's UI changes frequently. When DOM selectors or structure are relevant:
- Ask the user to provide actual markup from the page, OR
- Fetch from an actual GitHub issue/PR diff the user provides

Relevant selectors are in `rich-diff-detector.ts`, `click-handler.ts`, `existing-comment-scraper.ts`, and `native-comment-trigger.ts` — read those files first.

## Testing

Tests live in `tests/`. Currently covers:
- `url-parser.test.ts`
- `line-mapper.test.ts`

DOM-heavy modules (click-handler, rich-diff-detector, etc.) are tested manually by loading the built extension.
