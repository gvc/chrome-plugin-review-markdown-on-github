import type { PersistedComment, PersistedQueue } from '../shared/types';

const STORAGE_KEY = 'mdr_pendingComments';

async function readAll(): Promise<PersistedQueue> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as PersistedQueue) ?? {};
}

async function writeAll(data: PersistedQueue): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function loadComments(prKey: string): Promise<PersistedComment[]> {
  const data = await readAll();
  return data[prKey] ?? [];
}

export async function saveComment(prKey: string, comment: PersistedComment): Promise<void> {
  const data = await readAll();
  const list = data[prKey] ?? [];
  // Prevent duplicate by id
  if (!list.some((c) => c.id === comment.id)) {
    list.push(comment);
  }
  data[prKey] = list;
  await writeAll(data);
}

export async function updateStoredComment(prKey: string, commentId: string, newBody: string): Promise<void> {
  const data = await readAll();
  const list = data[prKey];
  if (!list) return;
  const comment = list.find((c) => c.id === commentId);
  if (!comment) return;
  comment.body = newBody;
  comment.createdAt = Date.now();
  await writeAll(data);
}

export async function removeComment(prKey: string, commentId: string): Promise<void> {
  const data = await readAll();
  const list = data[prKey];
  if (!list) return;
  data[prKey] = list.filter((c) => c.id !== commentId);
  if (data[prKey].length === 0) delete data[prKey];
  await writeAll(data);
}

export async function purgeStale(maxAgeMs: number): Promise<void> {
  const data = await readAll();
  const cutoff = Date.now() - maxAgeMs;
  let changed = false;

  for (const prKey of Object.keys(data)) {
    const before = data[prKey].length;
    data[prKey] = data[prKey].filter((c) => c.createdAt > cutoff);
    if (data[prKey].length === 0) {
      delete data[prKey];
      changed = true;
    } else if (data[prKey].length !== before) {
      changed = true;
    }
  }

  if (changed) await writeAll(data);
}

export type StorageChangeCallback = (prKey: string, comments: PersistedComment[]) => void;

export function onStorageChanged(cb: StorageChangeCallback): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const newData = (changes[STORAGE_KEY].newValue as PersistedQueue) ?? {};
    for (const prKey of Object.keys(newData)) {
      cb(prKey, newData[prKey]);
    }
  });
}
