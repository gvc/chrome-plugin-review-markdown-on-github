export interface PRUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

const PR_FILES_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(files|changes)/;
const PR_CHANGES_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/changes/;

export function parsePRUrl(pathname: string = window.location.pathname): PRUrl | null {
  const match = pathname.match(PR_FILES_RE);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

export function isPRChangesUrl(pathname: string = window.location.pathname): boolean {
  return PR_CHANGES_RE.test(pathname);
}

export function makePrKey(pr: PRUrl): string {
  return `${pr.owner}/${pr.repo}/${pr.prNumber}`;
}
