const PR_CHANGES_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/changes/;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'mdr:getTabId') {
    sendResponse({ tabId: sender.tab?.id });
    return true;
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    const url = new URL(details.url);
    console.debug('[MDR background] onHistoryStateUpdated fired', { url: details.url, tabId: details.tabId });
    if (!PR_CHANGES_RE.test(url.pathname)) {
      console.debug('[MDR background] URL does not match PR files/changes pattern — skipping');
      return;
    }
    console.debug('[MDR background] Matched — writing nav event to storage for tab', details.tabId);
    // Use storage.session so content script can react via storage.onChanged.
    // sendMessage can silently fail if the content script isn't ready yet.
    chrome.storage.session.set({ mdrNavEvent: { url: details.url, tabId: details.tabId, ts: Date.now() } }, () => {
      console.debug('[MDR background] Storage write done');
    });
  },
  { url: [{ hostEquals: 'github.com' }] }
);
