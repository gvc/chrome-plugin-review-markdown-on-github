import type { PersistedComment } from '../shared/types';
import { loadComments, saveComment, removeComment, onStorageChanged } from './comment-store';

// In-memory cache — fast synchronous reads, backed by chrome.storage.local
const queue = new Map<string, PersistedComment[]>();
let currentPrKey = '';

export function setPrKey(prKey: string): void {
  currentPrKey = prKey;
}

export async function restoreQueue(prKey: string): Promise<number> {
  setPrKey(prKey);
  const comments = await loadComments(prKey);
  queue.clear();
  for (const c of comments) {
    const list = queue.get(c.filePath) ?? [];
    list.push(c);
    queue.set(c.filePath, list);
  }
  return comments.length;
}

export async function enqueueComment(filePath: string, lineNumber: number, body: string): Promise<void> {
  const comment: PersistedComment = {
    id: crypto.randomUUID(),
    filePath,
    lineNumber,
    body,
    createdAt: Date.now(),
  };

  // Write-ahead: persist BEFORE updating cache
  await saveComment(currentPrKey, comment);

  const list = queue.get(filePath) ?? [];
  list.push(comment);
  queue.set(filePath, list);
}

export async function dequeueComment(filePath: string, commentId: string): Promise<void> {
  await removeComment(currentPrKey, commentId);

  const list = queue.get(filePath);
  if (list) {
    const idx = list.findIndex((c) => c.id === commentId);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) queue.delete(filePath);
  }
}

export function getQueuedComments(filePath: string): PersistedComment[] {
  return queue.get(filePath) ?? [];
}

export function hasQueued(filePath: string): boolean {
  return (queue.get(filePath)?.length ?? 0) > 0;
}

export function getQueuedCount(): number {
  let count = 0;
  for (const list of queue.values()) count += list.length;
  return count;
}

export function getAllQueued(): Map<string, PersistedComment[]> {
  return queue;
}

// Sync cache when another tab writes to storage
onStorageChanged((prKey, comments) => {
  if (prKey !== currentPrKey) return;
  queue.clear();
  for (const c of comments) {
    const list = queue.get(c.filePath) ?? [];
    list.push(c);
    queue.set(c.filePath, list);
  }
});
