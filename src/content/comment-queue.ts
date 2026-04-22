interface QueuedComment {
  lineNumber: number;
  body: string;
}

const queue = new Map<string, QueuedComment[]>();

export function enqueueComment(filePath: string, lineNumber: number, body: string): void {
  const existing = queue.get(filePath) ?? [];
  existing.push({ lineNumber, body });
  queue.set(filePath, existing);
}

export function dequeueComments(filePath: string): QueuedComment[] {
  const items = queue.get(filePath) ?? [];
  queue.delete(filePath);
  return items;
}

export function hasQueued(filePath: string): boolean {
  return (queue.get(filePath)?.length ?? 0) > 0;
}

export function clearQueue(): void {
  queue.clear();
}
