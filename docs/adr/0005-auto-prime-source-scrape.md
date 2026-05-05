# ADR-005: Auto-prime the source scrape on load

**Status:** Accepted
**Date:** 2026-05-05
**Supersedes part of:** earlier "user must toggle once to prime" behavior

## Context

To map rendered elements to source lines, MDR needs the raw markdown text. The only place it's available in the DOM is the source diff `<table>`. When rich diff is active, that table is not in the DOM at all — GitHub unmounts it.

Original behavior: when a markdown file loaded with rich diff already active, MDR did nothing. The user had to manually toggle to source diff and back at least once to give MDR the chance to scrape. This was undocumented, surprising, and frequently the cause of "the +button doesn't appear" reports.

## Decision

When `initialize()` finds a markdown file with rich diff active on first sight, MDR proactively:

1. Calls `switchToSourceDiff(container)` — programmatically clicks GitHub's source-diff button.
2. Waits for the table to appear (`waitForSourceDiff`, 3s timeout).
3. Scrapes raw markdown and existing review comments.
4. Calls `switchToRichDiff(container)` to switch back.
5. Runs `processFile()` (line map + click handlers + existing-comment rendering).

The user sees a brief flicker on first load — sometimes imperceptible, sometimes a half-second flash of source diff. Acceptable.

## Consequences

**Wins**
- Zero-config: open a PR with rich diff already on by default → commenting works immediately.
- Eliminates a class of "MDR is broken" reports that were really "you need to toggle first".
- The same code path handles existing-comment scraping, so existing comments also render without manual intervention.

**Costs**
- Visible flicker on first load. Mostly fast enough not to be noticed; occasionally slow on big files.
- Two extra programmatic toggles per markdown file on first load — adds load on GitHub's React.
- Race-prone if the user toggles manually during the priming sequence. Mitigated by the debounced toggle observer (ADR is implicit in `specs/resilience-fix.md` Fix 1) and `processingFile` guard.

## Alternatives considered

- **Background fetch of the raw file from `raw.githubusercontent.com`.** Rejected: needs an extra host permission, plus the head SHA, plus handling private repos and auth — and would not give us _diff context_ (which lines are part of the diff).
- **Refuse to act until user toggles.** Rejected: see "context" — surprising and frequently wrong.
- **Hidden iframe with source diff.** Rejected: GitHub won't render the diff in an iframe context, and same-origin manipulation of GitHub's React state from an iframe is asking for trouble.
