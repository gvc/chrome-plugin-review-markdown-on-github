# Architecture Decision Records

Each ADR captures a decision, the context that forced it, and the trade-offs accepted. New decisions get a new file; existing ones are not edited except to mark superseded status.

| # | Title | Status |
|---|---|---|
| [0001](0001-no-github-api-token.md) | Post comments via GitHub's native UI, not the API | Accepted |
| [0002](0002-line-matching-cascade.md) | Cascade of matching strategies with confidence reporting | Accepted |
| [0003](0003-queue-then-flush.md) | Queue-then-flush comment posting | Accepted |
| [0004](0004-spa-nav-via-background-sw.md) | Detect SPA navigation via background SW + `storage.session` | Accepted |
| [0005](0005-auto-prime-source-scrape.md) | Auto-prime the source scrape on load | Accepted |
| [0006](0006-right-side-targeting.md) | Always target `data-diff-side="right"` for split diffs | Accepted |

System overview: [`specs/system-overview.md`](../../specs/system-overview.md).
