export async function createCommentViaApi(
  token: string,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    body: string;
    path: string;
    line: number;
    commitId: string;
    side: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const resp = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        body: params.body,
        commit_id: params.commitId,
        path: params.path,
        line: params.line,
        side: params.side,
      }),
    }
  );

  if (resp.ok) return { success: true };

  const err = await resp.json().catch(() => ({ message: `HTTP ${resp.status}` }));
  return { success: false, error: err.message ?? `HTTP ${resp.status}` };
}

export async function fetchCommentsViaApi(
  token: string,
  params: { owner: string; repo: string; prNumber: number }
): Promise<unknown[]> {
  const comments: unknown[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.prNumber}/comments?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!resp.ok) {
      throw new Error(`GitHub API error: ${resp.status}`);
    }

    const batch = await resp.json();
    comments.push(...batch);

    if (batch.length < 100) break;
    page++;
  }

  return comments;
}
