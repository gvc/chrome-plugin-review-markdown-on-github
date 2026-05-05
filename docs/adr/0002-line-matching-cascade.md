# ADR-002: Cascade of matching strategies with confidence reporting

**Status:** Accepted
**Date:** 2026-05-05

## Context

Mapping a rendered DOM element back to a source line is the hard problem at the centre of MDR. Inputs are noisy:

- Markdown renderer rewrites text (smart quotes, entity decoding, link text replaces full `[text](url)`).
- HTML elements are coarser than source lines (a `<p>` may span several source lines; a `<li>` may contain inline children).
- Tables, blockquotes, nested lists, code fences — each has different structural rules.
- Some renderers add `data-sourcepos` attributes; most don't.
- GitHub strips trailing whitespace, normalises non-breaking spaces, etc.

A single matching algorithm is wrong some of the time. Failing silently when wrong is worse than failing visibly.

## Decision

Try strategies in order of decreasing confidence. Stop at the first hit. Report which strategy won as a `confidence` field on the match, and surface low-confidence matches to the user via the comment form.

Strategies (see `line-mapper.ts:matchElementToLine`):

1. **`exact`** — `data-sourcepos` attribute (definitive when present).
2. **`exact`** — Normalized text (whitespace collapsed, lowercased) equals a source line's normalized form.
3. **`first-line`** — First rendered line of the element matches a source line normalized.
4. **`stripped`** — Markdown syntax stripped (`#`, `**`, `[]()`, etc.) on both sides; equality match.
5. **`fuzzy`** — 80-char prefix substring match in either direction. Min length 24 to avoid spurious hits.
6. **`positional`** — Last resort. Find the Nth element of this tag among siblings, find the Nth source line of the matching shape.

The user-facing comment form reads `match.confidence` and shows a badge for non-exact matches so the reviewer can sanity-check before submitting.

## Consequences

**Wins**
- Coverage. The 80% case (paragraphs, headings, list items in plain prose) hits at strategy 2 or 4. Edge cases reach 5 or 6 instead of dying.
- Honest. Low-confidence matches are not silently equated with high-confidence ones — the reviewer is told.
- Easy to extend. Adding a new strategy is a new branch in the cascade, ordered by trustworthiness.

**Costs**
- Six paths to maintain. New ones must specify their confidence relative to existing ones, which is judgement-call territory.
- Positional fallback can mismatch in edge cases (e.g., a heading that's been re-ordered between drafts). Confidence badge mitigates but doesn't eliminate.
- Test surface is large. `tests/line-mapper.test.ts` covers core normalisation and stripping; the cascade itself is mostly covered by manual review.

## Alternatives considered

- **Source maps via the markdown renderer.** Rejected: GitHub doesn't expose a source map for its rich diff. We'd need to re-render markdown ourselves and hope it matches GitHub's output byte-for-byte. It won't.
- **Single fuzzy algorithm (e.g., Levenshtein) with a threshold.** Rejected: thresholds are unprincipled, and ranked exact-vs-fuzzy is a real distinction worth surfacing.
- **Refuse to comment on non-exact matches.** Rejected: too restrictive. Reviewers would lose the feature on tables and complex lists where it's most useful to have rendered view.
