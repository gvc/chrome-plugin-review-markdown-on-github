export const MSG = {
  CREATE_COMMENT: 'CREATE_COMMENT',
  FETCH_COMMENTS: 'FETCH_COMMENTS',
  GET_ENABLED: 'GET_ENABLED',
  SET_ENABLED: 'SET_ENABLED',
} as const;

export interface CreateCommentPayload {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  path: string;
  line: number;
  commitId: string;
  side: 'LEFT' | 'RIGHT';
}

export interface FetchCommentsPayload {
  owner: string;
  repo: string;
  prNumber: number;
}

export type Message =
  | { type: typeof MSG.CREATE_COMMENT; payload: CreateCommentPayload }
  | { type: typeof MSG.FETCH_COMMENTS; payload: FetchCommentsPayload }
  | { type: typeof MSG.GET_ENABLED }
  | { type: typeof MSG.SET_ENABLED; payload: { enabled: boolean } };

export function sendMessage<R>(message: Message): Promise<R> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}
