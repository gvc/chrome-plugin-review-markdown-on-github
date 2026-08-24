# RFC-005: Adversarial Duplicates

Every block in this document is chosen to break resolution that searches the
whole file and takes the first hit. Repetition here is deliberate, not an
editing mistake.

## Repeated headings

The same heading text appears under several parents. Rendered output gives each
one a unique anchor; the source gives them identical text.

### Motivation

Placeholder body for the first Motivation section.

### Alternatives considered

Placeholder body for the first Alternatives section.

### Open questions

Placeholder body for the first Open questions section.

## Second parent

### Motivation

Placeholder body for the second Motivation section.

### Alternatives considered

Placeholder body for the second Alternatives section.

### Open questions

Placeholder body for the second Open questions section.

## Third parent

### Motivation

Placeholder body for the third Motivation section.

### Alternatives considered

Placeholder body for the third Alternatives section.

### Open questions

Placeholder body for the third Open questions section.

## Identical paragraphs

The paragraph below appears three times with no distinguishing text.

This proposal has no impact on existing behaviour and requires no migration.

Some intervening prose so the repeats are not adjacent.

This proposal changes existing behaviour and requires a one-time migration.

More intervening prose, again to separate the repeated blocks.

This proposal has no impact on existing behaviour and requires no migration.

## Short repeated lines

TBD

Resolved in this revision

TBD

N/A

N/A

N/A

## Repeated list items

First list:

- Not applicable
- To be decided
- No change required

Second list:

- Not applicable
- To be decided
- No change required

Third list:

- Not applicable
- To be decided
- No change required

## Repeated table rows

| Capability | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Reads source | Yes | Yes | Yes |
| Writes source | No | No | No |
| Requires network | No | No | No |
| Requires token | No | No | No |
| Reads source | Yes | Yes | Yes |
| Writes source | No | No | No |
| Requires network | No | Yes | Yes |
| Requires token | No | No | No |

## Near-duplicate paragraphs

The following two paragraphs differ by a single word, which is the case where a
prefix-substring comparison reports a confident match on the wrong block.

The mapper resolves each rendered block to exactly one source line, and reports
the score it used to decide, so a reviewer can confirm the target before
submitting a comment.

The mapper resolves each rendered block to exactly one source line, and reports
the evidence it used to decide, so a reviewer can confirm the target before
submitting a comment.

## Prefix-sharing paragraphs

Three paragraphs sharing a long common prefix, differing only at the end.

Line detection has to survive documents where whole sections are copied between
drafts and edited only lightly, because that is what an RFC revision looks like
in practice, and the differences arrive late in the block.

Line detection has to survive documents where whole sections are copied between
drafts and edited only lightly, because that is what an RFC revision looks like
in practice, and the differences arrive late in the paragraph.

Line detection has to survive documents where whole sections are copied between
drafts and edited only lightly, because that is what an RFC revision looks like
in practice, and the differences arrive late in the sentence.

## Identifiers that survive stripping

Values such as snake_case_name, __dunder_name__, CONSTANT_CASE_NAME, and
mixed_Case_Name must compare equal on both sides after stripping.

Comparisons such as `a < b`, `count <= limit`, and `x >= 0 && y < 10` contain
characters that a tag-removing regex will consume.

A sentence with an asterisk in the middle * that opens no emphasis.

A sentence with an underscore in the middle _ that opens no emphasis.

## Repeated code fences

```ts
const result = resolve(block);
```

```ts
const result = resolve(block);
```

```ts
const result = resolve(block);
```

## Repeated blockquotes

> The same quoted sentence appears more than once.

Intervening prose.

> The same quoted sentence appears more than once.

Intervening prose.

> The same quoted sentence appears more than once.

## Closing

Nothing below this line is expected to change between revisions, which makes it
useful as collapsed context in a pull request diff.
