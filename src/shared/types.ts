export interface GitHubPayload {
  owner: string;
  repo: string;
  prNumber: number;
  headCommitOid: string;
  baseCommitOid: string;
  headBranch: string;
  pullRequestId: string; // GraphQL node ID (e.g. "PR_kwDO...")
  currentUser: { login: string; avatarUrl: string } | null;
  diffEntries: DiffEntry[];
}

export interface DiffEntry {
  path: string;
  rawBlobUrl: string | null;
  oid: string;
}

export interface LineMapEntry {
  lineNumber: number;
  raw: string;
  normalized: string;
  stripped: string;
}

export type MatchConfidence =
  | 'exact'
  | 'first-line'
  | 'stripped'
  | 'fuzzy'
  | 'positional';

export interface LineMatch {
  lineNumber: number;
  confidence: MatchConfidence;
  filePath: string;
}
