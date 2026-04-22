export interface PRUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

const PR_FILES_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files/;

export function parsePRUrl(pathname: string = window.location.pathname): PRUrl | null {
  const match = pathname.match(PR_FILES_RE);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}
