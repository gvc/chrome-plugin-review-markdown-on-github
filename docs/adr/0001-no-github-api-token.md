# ADR-001: Post comments via GitHub's native UI, not the API

**Status:** Accepted
**Date:** 2026-05-05

## Context

The extension needs to post review comments on a PR. Two paths exist:

1. **GitHub REST/GraphQL API** — call `POST /repos/{owner}/{repo}/pulls/{n}/comments` directly. Needs an OAuth token or PAT.
2. **GitHub's own native comment form** — the textarea that appears when you click `+` on a source diff line. The user is already logged in.

## Decision

Use GitHub's native comment form. No API calls. No tokens.

The extension queues comments while the user is in rich diff. When the user (or the extension) switches to source diff, MDR finds the matching row, simulates the hover that exposes GitHub's `+` button, clicks it, waits for the textarea, and fills it using a React-aware native setter. The user reviews the prefilled drafts and posts them through GitHub's normal flow.

## Consequences

**Wins**
- Zero auth surface. No token storage, no OAuth flow, no scope grants, no rotation, no leak risk.
- Comments are indistinguishable from manually-posted ones. Notifications, review approval, suggestions — all work because GitHub itself created them.
- No rate-limit accounting. The user is just typing.
- Install friction is near-zero: load the extension, comment.

**Costs**
- Tightly coupled to GitHub's DOM. Selectors break when GitHub ships UI changes. Mitigated by multiple selector strategies (`native-comment-trigger.ts`) and explicit failure modes that surface to the user.
- Cannot post in batch silently — the user must be on the source diff view for the flush to run.
- Cannot reply to existing comment threads (only top-level line comments). Acceptable for now; threading was never the goal.
- `dispatchEvent(MouseEvent)` does not always reach React's synthetic event system. Hover injection works because GitHub's row hover handler is registered as a regular DOM listener; clicks on the resulting button are real DOM clicks. Brittle, but tested.

## Alternatives considered

- **OAuth app + PAT fallback.** Rejected: install friction, token rotation, scope-creep risk, support burden. Most reviewers wouldn't bother.
- **Hybrid (native UI for the happy path, API fallback).** Rejected: doubles the codepaths, doubles the auth surface, and the API path would be the one we'd debug at 11pm.
