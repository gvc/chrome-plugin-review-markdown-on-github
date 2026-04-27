# SPA Navigation Fix — `webNavigation.onHistoryStateUpdated`

## Problem

MDR was not activating when navigating to a PR `/files` or `/changes` page via GitHub's SPA (client-side navigation). GitHub uses Turbo/history pushState — the page never fully reloads, so the content script's existing `turbo:load` and `popstate` listeners were unreliable.

The content script runs once at `document_idle` on hard load. On SPA nav:
- `turbo:load` / `popstate` sometimes fire before GitHub has finished rendering the diff DOM
- `window.location` may still reflect the old URL when `initialize()` checks `isPRChangesUrl()`

## Approach

Use `browser.webNavigation.onHistoryStateUpdated` in a background service worker — it fires reliably on every history state change. Rather than using `chrome.tabs.sendMessage` (which silently fails if the content script message listener isn't ready), write to `chrome.storage.session`. The content script listens via `chrome.storage.onChanged`, which is always live once the script is injected.

## Why `storage.session` over `sendMessage`

`sendMessage` requires the receiving end to have its listener registered at the exact moment the message arrives. During SPA nav this is a race. `storage.onChanged` is an event emitter on an already-open channel — no race condition.

## Changes

### New file: `src/background/index.ts`

Service worker. Listens `webNavigation.onHistoryStateUpdated` filtered to `github.com`. On match against `/files` or `/changes`, writes `{ url, tabId, ts }` to `chrome.storage.session` under key `mdrNavEvent`.

```typescript
const PR_CHANGES_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/;

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    const url = new URL(details.url);
    console.debug('[MDR background] onHistoryStateUpdated fired', { url: details.url, tabId: details.tabId });
    if (!PR_CHANGES_RE.test(url.pathname)) {
      console.debug('[MDR background] URL does not match PR files/changes pattern — skipping');
      return;
    }
    console.debug('[MDR background] Matched — writing nav event to storage for tab', details.tabId);
    chrome.storage.session.set({ mdrNavEvent: { url: details.url, tabId: details.tabId, ts: Date.now() } }, () => {
      console.debug('[MDR background] Storage write done');
    });
  },
  { url: [{ hostEquals: 'github.com' }] }
);
```

### `src/content/index.ts`

- `initialize(force = false)` — `force = true` bypasses `isPRChangesUrl()` guard (background already verified the URL)
- `reinitialize(force = false)` — passes `force` through to `initialize`
- `setupNavigationListeners` now uses `chrome.storage.onChanged` to detect `mdrNavEvent` changes and calls `reinitialize(true)`
- `turbo:load` / `popstate` wrapped in arrow functions (were breaking TypeScript — `Event` not assignable to `boolean`)

### `manifest.json`

- Added `"webNavigation"` permission
- Added `"background": { "service_worker": "background/index.js", "type": "module" }`
- Version bumped `0.5.1` → `0.5.2`

### `webpack.config.js`

- Added `'background/index': './src/background/index.ts'` entry point

## Patch

```diff
diff --git a/manifest.json b/manifest.json
index ...
--- a/manifest.json
+++ b/manifest.json
@@ -1,9 +1,13 @@
-  "version": "0.5.1",
+  "version": "0.5.2",
   "description": "Comment on rendered markdown in GitHub PR rich diff view",
-  "permissions": ["storage"],
+  "permissions": ["storage", "webNavigation"],
+  "background": {
+    "service_worker": "background/index.js",
+    "type": "module"
+  },
   "host_permissions": ["https://github.com/*"],

diff --git a/src/background/index.ts b/src/background/index.ts
new file mode 100644
--- /dev/null
+++ b/src/background/index.ts
@@ -0,0 +1,19 @@
+const PR_CHANGES_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/;
+
+chrome.webNavigation.onHistoryStateUpdated.addListener(
+  (details) => {
+    const url = new URL(details.url);
+    console.debug('[MDR background] onHistoryStateUpdated fired', { url: details.url, tabId: details.tabId });
+    if (!PR_CHANGES_RE.test(url.pathname)) {
+      console.debug('[MDR background] URL does not match PR files/changes pattern — skipping');
+      return;
+    }
+    console.debug('[MDR background] Matched — writing nav event to storage for tab', details.tabId);
+    chrome.storage.session.set({ mdrNavEvent: { url: details.url, tabId: details.tabId, ts: Date.now() } }, () => {
+      console.debug('[MDR background] Storage write done');
+    });
+  },
+  { url: [{ hostEquals: 'github.com' }] }
+);

diff --git a/src/content/index.ts b/src/content/index.ts
--- a/src/content/index.ts
+++ b/src/content/index.ts
@@ -33,8 +33,8 @@
-async function initialize(): Promise<void> {
-  if (!isPRChangesUrl()) return;
+async function initialize(force = false): Promise<void> {
+  if (!force && !isPRChangesUrl()) return;

@@ -370,8 +370,17 @@
-  document.addEventListener('turbo:load', reinitialize);
-  window.addEventListener('popstate', reinitialize);
+  chrome.storage.onChanged.addListener((changes, area) => {
+    if (area !== 'session' || !changes.mdrNavEvent) return;
+    const { newValue } = changes.mdrNavEvent;
+    console.debug('[MDR content] mdrNavEvent storage change detected', newValue);
+    reinitialize(true);
+  });
+
+  document.addEventListener('turbo:load', () => reinitialize());
+  window.addEventListener('popstate', () => reinitialize());

@@ -395,7 +404,7 @@
-function reinitialize(): void {
+function reinitialize(force = false): void {
   if (reinitTimeout) clearTimeout(reinitTimeout);
   reinitTimeout = setTimeout(() => {
@@ -404,8 +413,7 @@
-    initialize();
+    initialize(force);
   }, 300);
 }

diff --git a/webpack.config.js b/webpack.config.js
--- a/webpack.config.js
+++ b/webpack.config.js
@@ -6,6 +6,7 @@
+    'background/index': './src/background/index.ts',
```

## Debugging

- **Background logs**: DevTools → `chrome://extensions` → MDR → "service worker" link
- **Content logs**: normal page DevTools console
- Key log to confirm end-to-end: `[MDR content] mdrNavEvent storage change detected`
