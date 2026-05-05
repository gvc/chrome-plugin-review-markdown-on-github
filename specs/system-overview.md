# Spec: MDR System Overview

**Status:** Living document
**Audience:** Contributors, reviewers, future maintainers
**Scope:** What the extension does, why it exists, and how the pieces fit together. Implementation details live in the code; ADRs in `docs/adr/` capture specific decisions and their rationale.

## Purpose

GitHub renders markdown changes two ways on a PR:

1. **Source diff** — line-by-line text view. Reviewers can leave inline comments on any line.
2. **Rich diff** — rendered HTML. Easy to read, but **read-only**. No way to comment.

Reviewers reading docs PRs constantly toggle between the two: read in rich, switch to source, scroll to find the line, comment, switch back. This breaks reading flow.

**MDR (Markdown Review)** lets reviewers comment directly on rendered elements in rich diff. Comments end up as standard GitHub PR review comments — same notifications, same review approval flow, no API tokens, no auth.

## Non-goals

- **Not a GitHub API client.** No tokens, no REST/GraphQL calls. All comment posting goes through GitHub's own native comment UI.
- **Not GitHub Enterprise (custom domains).** `github.com` only.
- **Not a markdown editor.** Just commenting on existing rendered output.
- **Not a replacement for source diff review.** Code changes still need source view; MDR adds an entry point for markdown reviewers.

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Browser tab on github.com/.../pull/N/files                   │
│                                                              │
│  ┌────────────────┐    chrome.storage.session                │
│  │ Background SW  │◄──────────────────────────┐              │
│  │ (webNavigation)│   "nav event for tab T"   │              │
│  └────────────────┘                           │              │
│         ▲                                     ▼              │
│         │ history pushState           ┌─────────────────┐    │
│         └─────────────────────────────│ Content script  │    │
│                                       │ (per PR page)   │    │
│                                       └────────┬────────┘    │
│                                                │             │
│      ┌─────────────────────────────────────────┼──────┐      │
│      │           GitHub PR DOM                 │      │      │
│      │  ┌────────────┐         ┌─────────────┐ │      │      │
│      │  │ Source diff│◄───────►│ Rich diff   │◄┘      │      │
│      │  │ <table>    │ toggle  │ <article>   │        │      │
│      │  └────────────┘         └─────────────┘        │      │
│      └─────────────────────────────────────────────────┘     │
│                                                              │
│  chrome.storage.local: persisted comment queue               │
└──────────────────────────────────────────────────────────────┘
```

Three runtime components:

| Component | File | Job |
|---|---|---|
| Background SW | `src/background/index.ts` | Detect SPA history changes, signal content script |
| Content script | `src/content/*` | All UI + logic; injected on PR pages |
| Popup | `src/popup/*` | Enable/disable toggle |

## Core flow

1. **Bootstrap** — Content script runs at `document_idle` on `/pull/*` pages. Verifies URL is `/files` or `/changes`. Extracts PR metadata (owner, repo, PR#, head OID) from GitHub's embedded page payload.
2. **Restore queue** — Loads any persisted comments for this PR from `chrome.storage.local`. Purges entries older than 7 days.
3. **Per markdown file** — For each markdown file container on the page:
   - If rich diff is active: programmatically toggle to source, scrape raw markdown + existing comments, toggle back. User never sees the flicker (or sees it only briefly).
   - If source diff is active: scrape immediately.
   - If the diff table is below the fold (lazy-loaded): set up a `MutationObserver` to scrape when it appears.
4. **Build line map** — Parse scraped raw markdown into `LineMapEntry[]` (raw, normalized, stripped variants per line). Walk rendered article, match each block element (`p`, `h*`, `li`, `pre`, etc.) against the line map using a cascade of strategies (see ADR-002).
5. **Attach UI** — Hover button on every matched element. Render existing PR review comments as inline badges on matching elements.
6. **Click → queue** — User clicks `+`, types comment, submits. Comment is enqueued in memory and persisted to `chrome.storage.local`. Floating MDR button shows queued count.
7. **Toggle to source → flush** — When user (or the extension itself) switches to source diff, the queue flushes. For each queued comment, MDR finds the right-side line row, simulates the hover that injects GitHub's add-comment button, clicks it, waits for the textarea, fills it via React-aware setter, and removes the comment from the queue.
8. **SPA navigation** — Background SW writes a nav event to `chrome.storage.session`. Content script's `storage.onChanged` listener triggers a debounced reinitialize. Queue persists across navigation.

## Module map (content script)

| Module | Responsibility |
|---|---|
| `index.ts` | Orchestration, SPA nav, bootstrap, queue flush |
| `payload-extractor.ts` | Pull PR metadata from GitHub's embedded page data |
| `rich-diff-detector.ts` | Find markdown files; detect/observe rich vs source state; programmatic toggle |
| `line-mapper.ts` | Scrape raw markdown from source DOM; build line map; match elements to lines |
| `click-handler.ts` | Hover + click on rendered elements |
| `comment-form.ts` | Inline compose UI (textarea, submit, cancel, delete) |
| `comment-queue.ts` | In-memory queue, persisted via `comment-store` |
| `comment-store.ts` | `chrome.storage.local` persistence + 7-day TTL purge |
| `comment-panel.ts` | Floating MDR button + side panel listing queued comments |
| `existing-comment-scraper.ts` | Scrape existing review comments from source diff DOM |
| `existing-comment-renderer.ts` | Render scraped comments as inline badges on rich-diff elements |
| `native-comment-trigger.ts` | The "comment posting" path — find row, simulate hover, fill textarea |

## Key invariants

- **No GitHub API calls for posting.** All comment posting goes through GitHub's native comment UI. No tokens stored.
- **Queue is durable.** Persisted to `chrome.storage.local`. Survives page reload, SPA nav, browser restart. Purged after 7 days.
- **Right side only.** All line targeting (scrape, find row, trigger comment) targets `data-diff-side="right"` cells. Split diffs render the same line number on both sides.
- **One comment per (file, line).** Re-clicking a commented element edits in place.

## Failure modes (acknowledged)

| Failure | Mitigation |
|---|---|
| GitHub DOM changes break selectors | Multiple selector strategies per concern (legacy + 2024 + new). Console warnings on miss. |
| Toggle observer fires mid-transition | 300ms debounce on `observeRichDiffToggle`. Re-check ground truth after settle. |
| `triggerAddCommentButton` finds no clickable target | Retry with backoff (3 attempts, 500ms+1000ms). Fallback strategies (hover, click number cell, click code cell, generic comment button). |
| Element text doesn't match any source line | Cascade through 6 matching strategies; report `confidence` to user via badge. |
| Lazy-loaded file below fold | `MutationObserver` on container parent watches for table insertion. |
| Comment cannot be posted at all | Stays in queue, retried on next source toggle. As last resort, dumped to console with file path + line + body so the user can copy them out manually. |

## Versioning

Every code change bumps `manifest.json` version. Users reload the unpacked extension manually after pulling — the version number is the cue that there's something new to load.

## Related specs

- `specs/spa-navigation-fix.md` — Why background SW + `storage.session` instead of in-page `turbo:load` listeners.
- `specs/resilience-fix.md` — Toggle race + comment-trigger reliability fixes (Bugs 1–4 and Fixes 1–7).

## Related ADRs

- [ADR-001](../docs/adr/0001-no-github-api-token.md) — Use GitHub's native comment UI; no API tokens
- [ADR-002](../docs/adr/0002-line-matching-cascade.md) — Cascade of matching strategies with confidence reporting
- [ADR-003](../docs/adr/0003-queue-then-flush.md) — Comments queued in rich diff, flushed in source diff
- [ADR-004](../docs/adr/0004-spa-nav-via-background-sw.md) — Background SW + `storage.session` for SPA navigation
- [ADR-005](../docs/adr/0005-auto-prime-source-scrape.md) — Programmatic toggle on load to scrape raw markdown
- [ADR-006](../docs/adr/0006-right-side-targeting.md) — Always target `data-diff-side="right"` for split diffs
