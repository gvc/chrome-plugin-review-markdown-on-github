# RFC-003: Code and Tables

Code fences and tables are the two constructs where a naive line-oriented
tokenizer produces the most wrong answers. A fence swallows everything until it
closes; a table spans many source lines and renders as a grid of cells.

## Fenced code

A fence with a language tag:

```ts
export function compute(input: number): number {
  return input * 2;
}
```

A fence with no language tag:

```
plain text inside a fence
no syntax highlighting applied
```

A fence using tildes instead of backticks:

~~~python
def compute(value):
    return value * 2
~~~

A fence with an info string carrying more than a language:

```js title="example.js"
const answer = 42;
```

## Fences containing markdown

Everything between the fence markers is literal. A tokenizer that scans line by
line without tracking fence state will treat the lines below as headings, list
items, and a table.

```markdown
# This is not a heading

- This is not a list item
- Neither is this

| Not | A | Table |
|---|---|---|
| a | b | c |

> Not a blockquote

**Not bold**
```

A tilde fence containing a backtick fence:

~~~markdown
```ts
const nested = true;
```
~~~

A fence containing what looks like a closing fence but is indented:

```text
  ```
  still inside the outer fence
  ```
```

## Indented code

    four spaces of indentation
    produce an indented code block
    with no language tag

Text after the indented block returns to normal prose.

## Code containing angle brackets and entities

```html
<div class="container">
  <span>&amp; &lt; &gt;</span>
</div>
```

```cpp
template <typename T>
bool less(const T& a, const T& b) { return a < b; }
```

## Long lines in code

```sh
docker run --rm -it --volume "$(pwd):/work" --workdir /work --env CI=true ghcr.io/example/toolchain:latest ./scripts/build.sh --target release --verbose
```

## Simple tables

| Column A | Column B |
|---|---|
| a1 | b1 |
| a2 | b2 |

## Alignment

| Left | Centre | Right |
|:---|:---:|---:|
| one | two | three |
| four | five | six |

## Formatting inside cells

| Construct | Example | Notes |
|---|---|---|
| Bold | **bold text** | Renders inside the cell |
| Code | `const x = 1` | Backticks work in cells |
| Link | [spec](https://github.github.com/gfm/) | Links work in cells |
| Strike | ~~removed~~ | So does strikethrough |
| Escaped pipe | a \| b | The pipe must be escaped |

## Empty and ragged cells

| One | Two | Three |
|---|---|---|
| filled |  | filled |
|  | filled |  |
| filled | filled | filled |

A row with fewer cells than the header renders with trailing empties:

| A | B | C |
|---|---|---|
| only one |
| two | cells |

## Wide table

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | yes | none | Unique identifier for the record |
| `name` | string | yes | none | Human readable label shown in the UI |
| `enabled` | boolean | no | `true` | Whether the record participates in matching |
| `weight` | number | no | `1.0` | Relative weight applied during scoring |
| `tags` | string[] | no | `[]` | Free-form labels used for filtering |

## Repeated cell values

Identical cell text across many rows is the adversarial case for text matching.

| Feature | Supported | Notes |
|---|---|---|
| Headings | Yes | N/A |
| Lists | Yes | N/A |
| Tables | Yes | N/A |
| Footnotes | Yes | N/A |
| Definition lists | No | N/A |
| Custom containers | No | N/A |
