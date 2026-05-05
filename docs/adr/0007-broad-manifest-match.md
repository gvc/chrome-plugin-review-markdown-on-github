# ADR-007: Inject content script on all of `github.com`

**Status:** Accepted
**Date:** 2026-05-05
**Builds on:** [ADR-004](0004-spa-nav-via-background-sw.md)

## Context

ADR-004 moved SPA navigation detection to a background service worker that writes `mdrNavEvent` to `chrome.storage.session`. The content script reacts via `chrome.storage.onChanged`. This works only when the content script is already alive in the tab.

Manifest V3 content scripts inject at the `run_at` event of the **initial document load**, on URLs that match `content_scripts.matches`. They do **not** re-inject on `history.pushState` navigations.

Previous match pattern: `https://github.com/*/*/pull/*`. Symptom: when the user arrived at a pull request via SPA navigation from a non-pull page (e.g. `/pulls`, notifications, dashboard), the content script never injected — `document_idle` had already fired on the original page that did not match. The background SW kept writing `mdrNavEvent` into storage, but no listener was alive in the tab to react.

Result: the only way to activate MDR was a hard refresh on `/pull/N/files` or `/pull/N/changes` — a cold load that triggered manifest injection.

## Decision

Broaden the manifest `content_scripts.matches` to `https://github.com/*`. The content script now injects on every github.com page. `initialize()` already short-circuits at the top with `isPRChangesUrl()`, so on non-PR pages the script is effectively idle. `setupNavigationListeners()` registers the `storage.onChanged` / `turbo:load` / DOM-mutation listeners regardless, so the tab is primed to react when the user later navigates into a PR.

## Consequences

**Wins**
- SPA navigation from `/pulls`, notifications, or any github.com page into a PR now activates MDR without a hard refresh.
- No new permissions. `host_permissions` was already `https://github.com/*`.

**Costs**
- Content script bytes are parsed on every github.com page, including pages MDR has no business on (homepage, settings, profile). Bail-out is one URL check; cost is negligible but nonzero.
- More surface area for accidental side effects. Mitigated by the `isPRChangesUrl()` guard at the top of `initialize()` and the fact that no UI is created until a payload is extracted.

## Alternatives considered

- **Programmatic injection from the background SW** via `chrome.scripting.executeScript` on nav events. Rejected: adds a `scripting` permission, requires deduplication to avoid double-injection, and is more moving parts than a manifest match change for the same outcome.
- **Keep narrow manifest match, add a separate lightweight listener-only stub on a broader match.** Rejected: two bundles to maintain; the full content script is small enough that splitting is not worth the complexity.
- **Stay narrow and document the hard-refresh requirement.** Rejected: the hard-refresh workaround is the bug we are fixing.
