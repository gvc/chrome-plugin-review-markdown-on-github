# ADR-003: Queue-then-flush comment posting

**Status:** Accepted
**Date:** 2026-05-05

## Context

ADR-001 commits us to using GitHub's native comment form. That form lives only on the source diff. So the basic shape of the user flow is fixed:

- User reads rich diff.
- User wants to comment.
- Comment must be entered into a form that doesn't currently exist on screen.

Two ways to handle this:

1. **Synchronous post.** Each click programmatically toggles to source, opens the form, fills it, submits, toggles back. UX flicker per comment.
2. **Queue and batch flush.** Collect comments in rich diff. When the user switches to source diff (their natural next step), flush them all.

## Decision

Queue, then flush.

- `comment-queue.ts` holds an in-memory map keyed by file path; `comment-store.ts` mirrors it to `chrome.storage.local` keyed by `prKey` (owner/repo/PR#).
- A floating MDR button shows the queued count and opens a side panel listing all pending comments (editable, deletable).
- The rich/source toggle observer triggers `flushQueue()` when the file enters source view.
- Each flushed comment that fails to post stays in the queue and is retried on the next source-diff toggle. Successful ones are dequeued individually.
- As a last resort, persistently-failing comments are dumped to the console with file path, line, and body, so the user can manually copy them out.

## Consequences

**Wins**
- Smooth reading flow. Reviewer reads end-to-end in rich diff; no toggling per comment.
- Survives navigation. Closing the tab, refreshing, navigating away — queue persists for 7 days.
- Honest about failure. Comments are never silently lost — they stay in the queue, and the side panel shows them.
- Composable: the user can queue 10, switch once, and review all 10 prefilled drafts.

**Costs**
- Two-phase mental model. Users must learn that "Comment" queues, doesn't post. Mitigated by the toast (`N comment(s) queued — switch to Source diff to post`).
- Storage growth. Bounded by 7-day TTL purge; small in practice (text only).
- Flush is sequential with a 300ms gap between comments to give GitHub's React time to settle. 10 queued comments takes ~3s plus form-fill time.
- If the user never switches back to source diff in this session, comments sit unposted. They will flush on the next visit.

## Alternatives considered

- **Synchronous post (toggle per comment).** Rejected: the flicker is jarring and breaks reading flow — the very thing this extension exists to preserve.
- **Background flush (toggle invisibly).** Rejected: GitHub renders the source table only when active, and posting through native UI requires the form to be interactable, which means visible. Hiding it via CSS would break GitHub's React event handlers.
- **Forget persistence; queue only in-memory.** Rejected: a refresh would silently destroy work in progress. The extension's job is to not lose comments.
