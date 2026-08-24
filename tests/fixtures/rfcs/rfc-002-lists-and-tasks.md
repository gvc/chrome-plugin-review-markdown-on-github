# RFC-002: Lists and Tasks

List items are the construct where rendered structure and source structure
diverge most. This document covers nesting, looseness, markers, and the blocks
that lists can contain.

## Unordered lists

- First item
- Second item
- Third item

Different markers produce the same rendered output but different source bytes.

* Asterisk item one
* Asterisk item two

+ Plus item one
+ Plus item two
+ Plus item three

## Ordered lists

1. First step
2. Second step
3. Third step

An ordered list that starts at a number other than one:

7. Seventh
8. Eighth
9. Ninth

Lazy numbering renders sequentially regardless of the source numbers:

1. Renders as one
1. Renders as two
1. Renders as three

## Tight and loose lists

A tight list puts text directly in the item element:

- Tight one
- Tight two
- Tight three

A loose list wraps each item's text in a paragraph, which means the rendered
tree has an extra level and a matcher can attach to the wrong node:

- Loose one

- Loose two

- Loose three

## Nesting

- Level one, first item
  - Level two, first item
    - Level three, first item
      - Level four, first item
      - Level four, second item
    - Level three, second item
  - Level two, second item
- Level one, second item
- Level one, third item
  - Level two, added under the third item

Mixed ordered and unordered nesting:

1. Ordered outer, first
   - Unordered inner, first
   - Unordered inner, second
     1. Ordered innermost, first
     2. Ordered innermost, second
2. Ordered outer, second

## Wrapped list items

- An item whose text wraps across several source lines keeps a single rendered
  element while the source holds one entry per line, exactly as a paragraph
  does, except the continuation lines carry indentation that has to be stripped
  before comparison.
- A short item added after the wrapped one, with different wording.

## Task lists

- [x] Unchecked task, now completed
- [x] Checked task
- [ ] Another unchecked task
- [X] Checked with a capital marker

Nested tasks:

- [ ] Parent task
  - [x] Completed subtask
  - [ ] Pending subtask
- [x] Sibling task

The rendered output inserts a checkbox input before the text. Reading the
element's text content without removing that input picks up nothing visible but
changes the node structure.

## Lists containing other blocks

- An item followed by a fenced code block:

  ```ts
  const value = compute();
  ```

- An item followed by a blockquote:

  > Quoted text inside a list item.

- An item followed by a table:

  | Key | Value |
  |---|---|
  | one | 1 |

- An item containing two paragraphs:

  The first paragraph of the item.

  The second paragraph of the item.

## Lazy continuation

- An item whose continuation line omits the expected indentation
still belongs to the item because of lazy continuation rules.

1. The same rule applies to ordered items
and their continuation lines.

## Definition-style lists

GitHub does not implement definition lists, so this renders as a paragraph with
line breaks rather than a description list:

Term one
: Definition of term one

Term two
: Definition of term two

## Repeated items

The same item text appearing in several lists is the case that breaks
first-match-wins resolution.

Group A:

- Not applicable
- Not applicable
- Not applicable

Group B:

- Not applicable
- Not applicable
- Not applicable
