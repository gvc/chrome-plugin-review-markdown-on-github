# ADR-004: Detect SPA navigation via background SW + `storage.session`

**Status:** Accepted
**Date:** 2026-05-05
**Supersedes part of:** earlier in-page `turbo:load` / `popstate` approach

## Context

GitHub uses Turbo (Hotwire) for client-side navigation. Clicking from `/pull/123` to `/pull/123/files` does not trigger a full page load. The MV3 content script is injected once at `document_idle` on the first page that matches; subsequent SPA navigations don't re-run it.

Original approach: listen to `turbo:load` and `popstate` inside the content script. Symptoms:

- `turbo:load` sometimes fires before GitHub finishes rendering the diff DOM. `initialize()` runs, sees no diff, exits.
- `popstate` doesn't always fire on Turbo navigation.
- `window.location` can still reflect the old URL when these events fire — `isPRChangesUrl()` returns false and we bail.

The result: MDR fails to activate on SPA-navigation arrivals to `/files` or `/changes`.

## Decision

Move detection to a background service worker that hooks `chrome.webNavigation.onHistoryStateUpdated`, filtered to `github.com`. On a match against `/pull/N/(files|changes)`, write `{ url, tabId, ts }` to `chrome.storage.session` under key `mdrNavEvent`.

The content script subscribes via `chrome.storage.onChanged`. Receiving the event triggers `reinitialize(force = true)` — `force` bypasses the `isPRChangesUrl()` guard because the background already verified the URL pattern, even if `window.location` is stale.

Per-tab filtering: content script asks the background for its own `tabId` once at startup, then ignores nav events for other tabs.

## Consequences

**Wins**
- `webNavigation.onHistoryStateUpdated` fires reliably on every history pushState. No race with React's render schedule.
- `storage.onChanged` is an event emitter on an open channel — no missed-message race like `chrome.tabs.sendMessage` (which silently drops if no listener is registered exactly at delivery time).
- The content script keeps owning the work; the background SW is a thin postman.
- We still keep the in-page `turbo:load` / `popstate` / DOM-mutation listeners as a belt-and-braces fallback for edge cases.

**Costs**
- Adds `webNavigation` permission. Chrome shows a stronger consent string. Acceptable trade for reliability.
- Adds a service worker bundle (`background/index.ts`). Tiny, but it's another thing to load.
- Need a `mdr:getTabId` round-trip on content-script bootstrap to filter events. One message; cheap.

## Alternatives considered

- **`chrome.tabs.sendMessage` from background.** Rejected: requires the receiver's listener to be live at exactly the moment of `sendMessage`; during nav this is a race. `storage.onChanged` doesn't have this problem.
- **Re-injecting the content script on every history change.** Rejected: leaks state, doubles event listeners, and is heavier than a single re-init call.
- **`declarativeNetRequest` redirect tricks.** Rejected: not applicable to SPA nav; only fires on real network requests.
