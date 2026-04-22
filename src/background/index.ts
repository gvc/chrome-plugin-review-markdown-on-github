import { MSG } from '../shared/messages';
import { createCommentViaApi, fetchCommentsViaApi } from './github-api';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case MSG.CREATE_COMMENT:
      handleCreateComment(message.payload).then(sendResponse);
      return true;

    case MSG.FETCH_COMMENTS:
      handleFetchComments(message.payload).then(sendResponse);
      return true;

    case MSG.GET_ENABLED:
      chrome.storage.sync.get('enabled', (data) => {
        sendResponse({ enabled: data.enabled !== false });
      });
      return true;

    case MSG.SET_ENABLED:
      chrome.storage.sync.set({ enabled: message.payload.enabled }, () => {
        sendResponse({ ok: true });
      });
      return true;
  }
});

async function handleCreateComment(payload: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  path: string;
  line: number;
  commitId: string;
  side: string;
}): Promise<{ success: boolean; error?: string }> {
  const { pat } = await chrome.storage.sync.get('pat');
  if (!pat) {
    return { success: false, error: 'No GitHub token configured' };
  }
  return createCommentViaApi(pat, payload);
}

async function handleFetchComments(payload: {
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<{ comments: unknown[]; error?: string }> {
  const { pat } = await chrome.storage.sync.get('pat');
  if (!pat) {
    return { comments: [], error: 'No GitHub token configured' };
  }
  try {
    const comments = await fetchCommentsViaApi(pat, payload);
    return { comments };
  } catch (err) {
    return { comments: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
