import { describe, it, expect } from 'vitest';
import { parsePRUrl } from '../src/shared/url-parser';

describe('parsePRUrl', () => {
  it('parses standard PR files URL', () => {
    const result = parsePRUrl('/octocat/hello-world/pull/42/files');
    expect(result).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      prNumber: 42,
    });
  });

  it('parses PR files URL with query params', () => {
    const result = parsePRUrl('/org/repo/pull/123/files?diff=split&w=1');
    expect(result).toEqual({
      owner: 'org',
      repo: 'repo',
      prNumber: 123,
    });
  });

  it('parses PR files URL with hash', () => {
    const result = parsePRUrl('/a/b/pull/1/files#diff-abc123');
    expect(result).toEqual({ owner: 'a', repo: 'b', prNumber: 1 });
  });

  it('returns null for non-PR URL', () => {
    expect(parsePRUrl('/octocat/hello-world')).toBeNull();
    expect(parsePRUrl('/octocat/hello-world/pull/42')).toBeNull();
    expect(parsePRUrl('/octocat/hello-world/issues/42')).toBeNull();
    expect(parsePRUrl('/')).toBeNull();
  });

  it('handles numeric-only repo names', () => {
    const result = parsePRUrl('/user/123/pull/456/files');
    expect(result).toEqual({ owner: 'user', repo: '123', prNumber: 456 });
  });

  it('parses PR changes URL (GitHub redirect from /files)', () => {
    const result = parsePRUrl('/octocat/hello-world/pull/102/changes');
    expect(result).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      prNumber: 102,
    });
  });

  it('parses PR changes URL with query params', () => {
    const result = parsePRUrl('/org/repo/pull/99/changes?diff=split');
    expect(result).toEqual({ owner: 'org', repo: 'repo', prNumber: 99 });
  });
});
