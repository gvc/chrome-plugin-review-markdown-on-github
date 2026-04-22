import type { GitHubPayload, PRKey, DraftComment } from '../shared/types';

const STORAGE_KEY = 'mdr_drafts';

async function readStore(): Promise<Record<string, DraftComment[]>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Record<string, DraftComment[]>) ?? {};
}

async function writeStore(store: Record<string, DraftComment[]>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

export function buildPRKey(payload: GitHubPayload): PRKey {
  return `${payload.owner}/${payload.repo}/${payload.prNumber}`;
}

export async function saveDraft(prKey: PRKey, draft: DraftComment): Promise<void> {
  const store = await readStore();
  const drafts = store[prKey] ?? [];
  drafts.push(draft);
  store[prKey] = drafts;
  await writeStore(store);
}

export async function getDrafts(prKey: PRKey): Promise<DraftComment[]> {
  const store = await readStore();
  return store[prKey] ?? [];
}

export async function deleteDraft(prKey: PRKey, draftId: string): Promise<void> {
  const store = await readStore();
  const drafts = store[prKey] ?? [];
  store[prKey] = drafts.filter((d) => d.id !== draftId);
  await writeStore(store);
}

export async function updateDraft(prKey: PRKey, draftId: string, newBody: string): Promise<void> {
  const store = await readStore();
  const drafts = store[prKey] ?? [];
  const target = drafts.find((d) => d.id === draftId);
  if (target) {
    target.body = newBody;
    store[prKey] = drafts;
    await writeStore(store);
  }
}

export async function deleteAllDrafts(prKey: PRKey): Promise<void> {
  const store = await readStore();
  delete store[prKey];
  await writeStore(store);
}
