import { GitHubPayload, DiffEntry } from '../shared/types';
import { parsePRUrl } from '../shared/url-parser';

let cachedPayload: GitHubPayload | null = null;

/**
 * Extract PR metadata from GitHub's embedded React payload.
 * GitHub injects a <script data-target="react-app.embeddedData"> tag
 * containing JSON with PR details, commit SHAs, and diff entries.
 */
export function extractPayload(): GitHubPayload | null {
  if (cachedPayload) return cachedPayload;

  const script = document.querySelector(
    'script[data-target="react-app.embeddedData"]'
  );

  if (script?.textContent) {
    try {
      const data = JSON.parse(script.textContent);
      cachedPayload = parseEmbeddedData(data);
      if (cachedPayload) return cachedPayload;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: parse URL + scrape what we can
  cachedPayload = buildFallbackPayload();
  return cachedPayload;
}

function parseEmbeddedData(data: Record<string, unknown>): GitHubPayload | null {
  try {
    // Navigate the nested structure — GitHub's payload shape varies,
    // so we try multiple known paths
    const payload = findNestedPayload(data);
    if (!payload) return null;

    const repo = payload.repo ?? payload.repository;
    const pr = payload.pullRequest ?? payload.pull_request;
    const comparison = payload.comparison;
    const currentUser = payload.currentUser;

    if (!repo || !pr) return null;

    const owner = repo.ownerLogin ?? repo.owner?.login ?? '';
    const repoName = repo.name ?? '';
    const prNumber = pr.number ?? 0;
    const headBranch = pr.headBranch ?? pr.headRefName ?? '';

    // GraphQL node ID — GitHub embeds this as pr.id (base64 "PR_kwDO...")
    const pullRequestId = pr.id ?? pr.node_id ?? '';

    const headCommitOid =
      comparison?.headCommitOid ??
      comparison?.headSha ??
      comparison?.fullDiff?.headOid ??
      pr.headRefOid ??
      '';

    const baseCommitOid =
      comparison?.baseCommitOid ??
      comparison?.baseSha ??
      comparison?.fullDiff?.baseOid ??
      pr.baseRefOid ??
      '';

    const rawEntries = payload.diffEntries ?? payload.diffSummaries ?? payload.files ?? [];
    const diffEntries: DiffEntry[] = rawEntries
      .map((entry: Record<string, unknown>) => ({
        path: (entry.path ?? entry.filename ?? '') as string,
        rawBlobUrl: (entry.rawBlobUrl ?? entry.raw_url ?? null) as string | null,
        oid: (entry.oid ?? entry.sha ?? '') as string,
      }));

    return {
      owner,
      repo: repoName,
      prNumber,
      headCommitOid,
      baseCommitOid,
      headBranch,
      pullRequestId: typeof pullRequestId === 'string' ? pullRequestId : '',
      currentUser: currentUser
        ? {
            login: currentUser.login ?? '',
            avatarUrl: currentUser.avatarUrl ?? currentUser.avatar_url ?? '',
          }
        : null,
      diffEntries,
    };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNestedPayload(data: any): any {
  // Direct payload
  if (data.pullRequest || data.pull_request) return data;

  // Nested under .payload
  if (data.payload) {
    // New GitHub structure: payload.pullRequestsChangesRoute
    if (data.payload.pullRequestsChangesRoute) {
      return data.payload.pullRequestsChangesRoute;
    }
    return findNestedPayload(data.payload);
  }

  // Nested under .props.initialPayload
  if (data.props?.initialPayload) return data.props.initialPayload;

  // Search one level deep for an object with pullRequest
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val && typeof val === 'object' && (val.pullRequest || val.pull_request)) {
      return val;
    }
  }

  return null;
}

function buildFallbackPayload(): GitHubPayload | null {
  const prUrl = parsePRUrl();
  if (!prUrl) return null;

  // Try to get head SHA from the page
  const headSha = extractHeadSha();

  return {
    owner: prUrl.owner,
    repo: prUrl.repo,
    prNumber: prUrl.prNumber,
    headCommitOid: headSha ?? '',
    baseCommitOid: '',
    headBranch: '',
    pullRequestId: '',
    currentUser: null,
    diffEntries: [],
  };
}

function extractHeadSha(): string | null {
  // GitHub sometimes puts the head SHA in a data attribute
  const el = document.querySelector('[data-commit]');
  if (el) return el.getAttribute('data-commit');

  // Check for it in a permalink element
  const permalink = document.querySelector('.js-permalink-shortcut');
  if (permalink) {
    const href = permalink.getAttribute('href') ?? '';
    const match = href.match(/\/([a-f0-9]{40})\//);
    if (match) return match[1];
  }

  return null;
}

export function clearPayloadCache(): void {
  cachedPayload = null;
}
