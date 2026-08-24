---
title: Prose and Structure
rfc: 001
status: Draft
authors:
  - fixture-bot
---

# RFC-001: Prose and Structure

This document exercises the block and inline constructs that carry ordinary
prose. It exists to be reviewed in GitHub's rich diff so the extension can be
tested against real rendered output.

Setext Heading Level One
========================

A setext heading claims two source lines but renders as a single element. The
tokenizer has to attribute the whole block to the first line, not the underline.

Setext Heading Level Two
------------------------

Text immediately after a setext underline starts a new paragraph.

## Paragraphs

A short paragraph on one line.

This paragraph is deliberately wrapped across several source lines so that the
rendered output collapses into a single element while the source keeps four
separate entries. A line-oriented matcher sees four candidates and matches none
of them exactly, which is the case that drives most of the positional fallbacks in
the current implementation.

Two paragraphs separated by a blank line stay separate.

A paragraph with a hard break at the end of this line  
continues on the next rendered line inside the same block.

A backslash break works too\
and produces the same rendered result from different source bytes.

## Emphasis

Plain text, *single asterisk italic*, _single underscore italic_, **double
asterisk bold**, __double underscore bold__, ***bold italic***, and
~~strikethrough~~ all appear inline.

Emphasis that spans a wrap boundary is **harder to strip because the opening
marker and the closing marker sit on different source lines** than the matcher
expects.

Words containing underscores such as `snake_case_identifier` and
another_bare_identifier must survive stripping intact. A naive regex that
removes every underscore turns these into different strings on each side of the
comparison.

## Inline code

Use `const` for bindings that never change. A code span containing a backtick is
written `` ` `` with padding. A code span containing markdown syntax like
`**not bold**` must not be interpreted.

Comparisons such as `a < b` and `x <= y && y >= z` contain angle brackets. A
stripper that removes anything matching an HTML tag pattern will eat them.

## Links

An inline link to [the GFM specification](https://github.github.com/gfm/).

A reference link to [the CommonMark spec][commonmark] resolves at the bottom of
the file.

A collapsed reference link to [commonmark][] uses the same target.

A shortcut reference link to [commonmark] omits the brackets entirely.

An autolink in angle brackets: <https://example.com/autolink>.

A bare URL that GitHub autolinks: https://example.com/bare-url

A link whose text contains formatting: [**bold link text**](https://example.com).

## Images

An inline image with alt text:

![Placeholder diagram](https://example.com/diagram.png)

A reference image: ![Reference alt][img-ref]

An image wrapped in a link:

[![Badge](https://example.com/badge.svg)](https://example.com/target)

## Blockquotes

> A single-line blockquote.

> A blockquote that wraps across several source lines behaves like a paragraph
> nested inside a quote element, which means the rendered block boundary and the
> source block boundary differ in the same way they do for plain paragraphs.

> Nested quoting starts here.
>
> > The second level sits inside the first.
> >
> > > And a third level inside that.

> A blockquote containing a list:
>
> - First quoted item
> - Second quoted item

> Lazy continuation means a quoted paragraph can omit the marker
on subsequent lines and still belong to the quote.

## Thematic breaks

A thematic break ends the preceding block, so the paragraph above and the
paragraph below belong to different blocks even without a blank line.

Three or more markers on their own line produce a rule.

---

***

___

## Escapes and entities

Escaped markdown characters render literally: \*not italic\*, \_not italic\_,
\# not a heading, \[not a link\], and a literal backslash \\.

HTML entities decode on render: &amp; becomes an ampersand, &lt; and &gt; become
angle brackets, &copy; becomes a copyright sign, and &nbsp; becomes a
non-breaking space that normalisation has to fold back to a plain space.

Numeric entities work the same way: &#35; and &#x23; both produce a hash.

## Mixed inline stress cases

A single paragraph combining **bold**, *italic*, `code`, ~~strikethrough~~, a
[link](https://example.com), an ![image](https://example.com/i.png), an entity
&amp;, an escape \*, and a comparison `a < b` in one block.

[commonmark]: https://spec.commonmark.org/
[img-ref]: https://example.com/reference-image.png
