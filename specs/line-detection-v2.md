# Spec: Line Detection v2

**Status:** Proposed
**Date:** 2026-08-24
**Scope:** `line-mapper.ts` and everything that feeds it. Replaces the ADR-002 cascade.

## Problem

Detection is the load-bearing part of MDR. When it is wrong, the reviewer's comment lands on
the wrong line of someone else's RFC — a failure that is worse than the extension not working
at all, because it is silent.

On long RFC documents the current matcher degrades badly. Six causes, all in the code today.

### 1. Ground truth is incomplete

`scrapeRawFromSourceDiff` reads only the rows GitHub rendered into the diff table. Collapsed
context is not in the DOM, so those lines become `''`:

```ts
const result = new Array<string>(maxLine).fill('');   // line-mapper.ts:80
```

A typical RFC PR edits three sections of a 900-line document. The rich diff renders the whole
document; the line map holds maybe 15% real content and 85% empty strings. Every rendered block
outside a hunk is unmatchable, and every empty entry is a decoy for the fuzzy strategies.

### 2. Matching is order-blind and first-match-wins

Every strategy is a `lineMap.find(...)` over the whole file. RFCs are full of repeated text:
`### Motivation`, `### Alternatives considered`, `N/A`, `Yes`, `No`, `TBD`, identical table
cells. The first occurrence wins for all of them.

`buildElementLineMap` then makes it worse:

```ts
if (match && !usedLines.has(match.lineNumber)) {   // line-mapper.ts:~280
```

Occurrence #1 takes the line; occurrences #2..#n are silently dropped and get no hover button.
So duplicated text produces both misattribution *and* missing coverage.

### 3. There is no block model

The map is one entry per source line. Real markdown blocks are not lines:

| Construct | Source | Rendered |
|---|---|---|
| Wrapped paragraph | 4 lines | one `<p>` |
| Fenced code | fence + body + fence | one `<pre>` |
| Table | header, separator, N rows | `<table>` with cells |
| Nested list | indented lines | nested `<li>` |
| Setext heading | text + `===` | one `<h1>` |
| `> [!NOTE]` alert | blockquote lines | styled `<div>` |

A `<p>` built from four wrapped source lines matches none of them exactly, so it falls through
to `fuzzy` (80-char prefix `includes`, very loose) or `positional`.

### 4. Normalization is weak on both sides

Source side: `stripMarkdown` is one regex pass. `[*_]{1,3}` eats underscores in `snake_case`.
`<[^>]+>` eats `a < b`. Leading list markers are stripped once, so nested items keep theirs.
Reference links, escapes, footnotes, autolinks, and entities are not handled.

DOM side: nothing at all. `element.textContent` picks up GitHub's injected heading anchor,
octicons, task-list checkboxes, and emoji alt text. **And in the rich diff it picks up both
sides of an inline change** — the `<del>` and the `<ins>` text concatenated — which can never
equal a head-side source line.

### 5. Confidence is a label, not a measurement

`MatchConfidence` records *which branch fired*, not *how good the match is*. A `fuzzy` hit on a
12-character prefix and a `fuzzy` hit on 80 identical characters are reported the same way.
There is no threshold, so the matcher never says "I don't know" — `positional` always answers.

### 6. Nothing is measured

No coverage number, no accuracy number, no fixtures from a real RFC. `tests/line-mapper.test.ts`
covers `normalize` and `stripMarkdown` in isolation. The cascade itself is untested. We cannot
tell whether a change helps.

## Target architecture

```
                 ┌──────────────────────────────┐
  raw blob  ───► │ 1. Source of truth           │  full head file, all lines
  (fetched)      │    + hunk/commentability map │  + Set<commentable line>
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ 2. Block tokenizer           │  SourceBlock[]
                 │    kind + startLine/endLine  │  ordered
                 └──────────────┬───────────────┘
                                │
  rich diff ───► ┌──────────────┴───────────────┐
  <article>      │ 3. DOM block extractor       │  RenderedBlock[]
                 │    ins-side text, cleaned    │  ordered
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ 4. Anchored monotonic        │  order-preserving
                 │    alignment (patience)      │  1:1 pairing
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ 5. Score + threshold         │  LineMatch | null
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ 6. UI: button / warn / hide  │
                 └──────────────────────────────┘
```

The central change is step 4. Rendered blocks appear in the same order as source blocks. Today
we throw that constraint away and search globally; v2 makes it the primary signal.

## Phases

Each phase ships independently and is measurable against the phase-0 harness.

### Phase 0 — Measure first

Nothing else is meaningful without a baseline.

- Add `src/content/debug.ts`: enabled by `localStorage.setItem('MDR_DEBUG','1')`.
  - Overlay a badge on each rendered block: matched line, confidence, score, strategy.
  - `console.table` summary per file: blocks total / matched / by confidence / unmatched.
  - `window.__mdr.dumpMapping()` → JSON blob suitable for a fixture.
- Add `tests/fixtures/`: for each case, `<name>.md` (raw head source),
  `<name>.rendered.html` (copied out of a real GitHub rich diff), `<name>.expected.json`
  (rendered-block index → source line).
- Add `tests/mapping-accuracy.test.ts`: run the mapper over every fixture in jsdom, report
  coverage and accuracy, fail below the committed thresholds.

**Blocked on you:** 3–5 real RFC fixtures. Per `CLAUDE.md` we do not guess GitHub's DOM. I need
the actual `<article>` outerHTML plus the matching raw `.md` from PRs you review.

**Exit:** a number for today's accuracy on real RFCs.

### Phase 1 — Complete, exact source of truth

Stop reconstructing the file from visible table rows.

- `src/content/raw-fetcher.ts`: resolve the head blob URL from
  `payload.diffEntries[].rawBlobUrl`, falling back to
  `https://github.com/{owner}/{repo}/raw/{headCommitOid}/{path}`.
- Fetch in the background service worker (`mdr:fetchRaw` message) with `credentials:'include'`
  so private repos work through the existing session. No token — ADR-001 holds. Add
  `raw.githubusercontent.com` to `host_permissions` if `rawBlobUrl` resolves there.
- Cache by blob OID in memory and `chrome.storage.session`.
- Fallback chain: raw blob → DOM scrape (today's path) → give up. Never mix the two.
- Separately, keep scraping the table to build a **commentability map**: the set of line numbers
  GitHub will actually accept a comment on, plus the hunk ranges around them.

**Exit:** line map covers 100% of the head file; `commentable` is explicit rather than implied
by "did the scrape find text here".

### Phase 2 — Block tokenizer

`src/content/markdown-blocks.ts` — a small CommonMark-shaped block scanner. Not a full parser;
block boundaries and line ranges only.

```ts
type BlockKind =
  | 'heading' | 'paragraph' | 'list-item' | 'code-fence'
  | 'table-row' | 'blockquote' | 'html-block' | 'thematic-break' | 'front-matter';

interface SourceBlock {
  kind: BlockKind;
  startLine: number;      // 1-based, the line a comment should target
  endLine: number;
  depth: number;          // list nesting / heading level
  text: string;           // inline-stripped, normalized
}
```

Rules that matter here: fenced code swallows everything until the closing fence (headings and
list markers inside a fence are not blocks); front matter is skipped; setext headings claim the
underline line; a table row is one block per line; lazy continuation lines join the paragraph.

Also in this phase: replace `stripMarkdown` with a staged inline stripper — code spans first,
then escapes, images, links (inline + reference), emphasis, autolinks, footnote refs, entities,
HTML tags — instead of one regex sweep. Keep the existing unit tests, extend them with the
cases that break today (`snake_case`, `a < b`, nested list markers, reference links).

**Exit:** tokenizer round-trips the fixture `.md` files; every non-blank source line belongs to
exactly one block.

### Phase 3 — Anchored monotonic alignment

`src/content/align.ts`. This is where the accuracy comes from.

```
source blocks:   S0  S1  S2  S3  S4  S5  S6  S7
                  │       │           │
                  ▼       ▼           ▼          unique-in-both exact matches
rendered blocks: R0  R1  R2  R3  R4  R5  R6      become anchors
                  │       │           │
                  └───────┴───────────┴────────► longest increasing subsequence
                                                  drops crossing anchors
   gaps between anchors: Needleman-Wunsch on a small window, similarity-scored
```

1. **Anchor pass** — blocks whose normalized text is unique in *both* sequences and equal.
   RFC headings, code fences, and long sentences give plenty.
2. **Monotonicity** — take the longest increasing subsequence of anchor pairs; discard the rest.
   This is what kills the duplicate-heading misattribution outright.
3. **Gap fill** — between consecutive anchors, run Needleman-Wunsch over the (small) sub-lists
   using the phase-4 similarity score. Windows are typically under 20 blocks, so cost is
   negligible; cap the window and fall back to greedy above the cap.
4. **Unaligned blocks stay unaligned.** No positional last resort.

Cost: O(n log n) for anchors plus O(w²) per gap. A 1000-line RFC maps in a few milliseconds.

**Exit:** duplicate-text fixtures map every occurrence to its own line. `usedLines` disappears —
1:1 pairing is a property of the alignment, not a post-hoc filter.

### Phase 4 — Real scoring, honest confidence

```ts
score = 0.60 * dice(bigrams(a), bigrams(b))
      + 0.25 * kindAgreement          // heading↔heading, li↔list-item, pre↔code-fence
      + 0.15 * positionPlausibility   // distance from the anchor-interpolated position
```

Thresholds → `exact` (≥0.95) / `high` (≥0.75) / `low` (≥0.55) / **unmatched** (below).

`MatchConfidence` becomes `'exact' | 'high' | 'low'` and `LineMatch` carries the numeric
`score`. ADR-002 rejected thresholds as "unprincipled"; the counter-argument is that the
cascade encodes the same judgement implicitly and cannot express "I don't know". This phase
supersedes ADR-002 — write ADR-009 recording the reversal and why.

**Exit:** zero silent misattributions on the fixtures. A block below threshold gets no button
rather than a wrong one.

### Phase 5 — DOM-side extraction

`src/content/rendered-blocks.ts`, replacing the `BLOCK_SELECTORS` string used in two places
(`line-mapper.ts` and `click-handler.ts` — they are duplicated and can drift).

- Clone the element before reading text. Remove `a.anchor`, `.octicon`, `[aria-hidden="true"]`,
  task-list `input`, footnote backrefs. Replace `img.emoji` with its `alt`.
- **Drop `<del>` subtrees, keep `<ins>`.** We compare against the head file, so the rendered
  text must be the head-side text. This alone should fix every changed paragraph in a diff.
- `<li>`: use direct text only, excluding nested `<ul>`/`<ol>`. Loose lists (`<li><p>`) map to
  the `<li>`, not the inner `<p>` — pick the outermost block per source line.
- Tables: map `<tr>` to the source row line; cells inherit the row's line. Commenting on a cell
  comments on its row, which is what GitHub can do anyway.
- `<pre>`: read verbatim text, match against the fence body; the comment targets the opening
  fence line.

**Exit:** one shared definition of "a commentable rendered block", used by mapper and click
handler alike.

### Phase 6 — Commentability and UX

Detection accuracy is wasted if the target line is not commentable.

- Element maps to a line inside a hunk → normal `+` button.
- Element maps to a line outside every hunk → distinct affordance. First try clicking GitHub's
  "expand context" control for the nearest hunk, re-scrape, and re-check. If that fails, show a
  disabled state with a reason instead of queueing a comment that will fail at flush time.
- `low` confidence → the form shows the matched source line text so the reviewer can confirm
  before submitting. Showing the line beats showing a badge.
- Failures at flush time already surface (`native-comment-trigger.ts` returns a reason); route
  the commentability check to the same message so the reviewer learns before typing, not after.

**Exit:** a queued comment either posts or the reviewer was told why before writing it.

### Phase 7 — Validate on real RFCs

Run the built extension against the RFC PRs the fixtures came from, plus two that were not used
for tuning. Compare against phase-0 numbers. Record the result in the ADR.

## File map

| File | Change |
|---|---|
| `src/content/raw-fetcher.ts` | new — head blob fetch + cache |
| `src/content/markdown-blocks.ts` | new — block tokenizer + inline stripper |
| `src/content/align.ts` | new — anchors, LIS, gap alignment |
| `src/content/rendered-blocks.ts` | new — DOM block extraction |
| `src/content/debug.ts` | new — overlay + dump |
| `src/content/line-mapper.ts` | shrinks to orchestration; cascade removed |
| `src/content/click-handler.ts` | consume shared block list, drop duplicated selectors |
| `src/content/comment-form.ts` | show matched source line for `low` matches |
| `src/content/index.ts` | fetch-first init, commentability wiring |
| `src/background/index.ts` | `mdr:fetchRaw` handler |
| `src/shared/types.ts` | `SourceBlock`, `RenderedBlock`, scored `LineMatch` |
| `manifest.json` | `raw.githubusercontent.com` host permission if needed |
| `docs/adr/0009-*.md` | new — supersedes ADR-002 |

## Risks

- **GitHub DOM churn.** Phases 5 and 6 touch selectors. Keep every DOM assumption in
  `rendered-blocks.ts` and `rich-diff-detector.ts` so breakage is one file deep.
- **Rich diff is a diff of the render, not a render of the head.** Phase 5 assumes `<ins>`/`<del>`
  wrapping. If GitHub marks changes some other way, the extraction rules change. Fixtures settle
  this before code is written.
- **Raw fetch blocked.** Private repos, SSO-gated orgs, or CSP could refuse the blob fetch. The
  DOM-scrape fallback stays; phase 1 is an upgrade, not a dependency.
- **Fixture overfitting.** Two held-out PRs in phase 7.

## Sequencing

Phase 0 first and alone — it is the only way to claim the rest worked. Then 1 → 2 → 3 in order;
each is a strict improvement on its own. Phases 4 and 5 can land in either order. Phase 6 last,
since it depends on the confidence numbers being real.

Rough shape: phase 0 and 1 are small. Phase 2 and 3 are the bulk of the work. Phases 4–6 are
mostly plumbing over what 2 and 3 produce.

## Open questions

1. Can you capture 3–5 RFC fixtures (rendered `<article>` outerHTML + raw `.md`)?
2. Do you review in split or unified diff? Split changes the DOM-side extraction.
3. Should deleted lines be commentable, or is head-side only enough?
4. Is a whole-file rendered view worth it — render the head file ourselves and diff against
   GitHub's render — or is head-side alignment sufficient?
