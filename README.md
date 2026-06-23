# scrape

Fetch web pages by CSS selector, convert HTML content to Markdown, save as `.md` files with frontmatter.

Designed for batch scraping from sitemaps with incremental updates. Built with Bun and Rust (`turndown-cdp`).

## Install

```bash
git clone https://github.com/FrameMuse/turndown-node ~/github/myforks/turndown-node
cd ~/github/myforks/turndown-node && cargo build --release

# build Rust converter
cd ~/github/mylibraries/web-scrapper/rust-converter
cargo build --release

# add alias
echo 'alias scrape="bun ~/github/mylibraries/web-scrapper/scripts/cli.ts"' >> ~/.bashrc
```

## Modes

Two modes controlled by presence of `--` flags:

- **Pipe mode** (no `--` flags): auto-detect selectors, write markdown to stdout. Progress and errors on stderr.
- **File mode** (any `--` flag present): explicit or auto-detect selectors, write `.md` files to `--output` directory. `--output` defaults to `.`.

```bash
# pipe mode — no flags at all
scrape https://example.com/page > page.md

# file mode — any -- flag
scrape --selector=".content" https://example.com/page
scrape --output="./docs" https://example.com/page
scrape --sitemap="..." --selector=".content" --output="./docs"
```

## Usage

No `--` flags. Auto-detects content container. Writes markdown to stdout.

```bash
scrape https://site.com/page > page.md
curl https://site.com/page | scrape > page.md
```

### File mode (flags present)

Any `--` flag switches to file mode. `--output` defaults to `.`.

```bash
# single page
scrape \
  --selector=".content" \
  --url-base="https://site.com/docs/" \
  --output="./docs" \
  https://site.com/docs/page

# sitemap batch
scrape \
  --sitemap="https://site.com/sitemap.xml" \
  --selector="div.theme-doc-markdown.markdown" \
  --url-base="https://site.com/docs/" \
  --concurrent=10 \
  --interval=200 \
  --output="./docs"

# dry run (preview without fetching)
scrape \
  --dry-run \
  --sitemap="https://site.com/sitemap.xml" \
  --selector=".content" \
  --url-base="https://site.com/docs/"
```

## Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--selector` | `string`, repeatable |  | CSS selector for content container. Tried in order, first match wins |
| `--match` | `string` |  | Override: explicit regex with capture group. Skips CSS conversion |
| `--url-base` | `string` | required | Full URL prefix to strip when computing relative `.md` paths |
| `--url-filter` | `string` | `--url-base` | Only scrape URLs starting with this string |
| `--sitemap` | `string` |  | Sitemap XML URL for batch scraping |
| `--concurrent` | `int` | 1 | Pages per batch. All N fire in parallel, all must finish before interval |
| `--interval` | `int` | 200 | Milliseconds between batches |
| `--offset` | `int` | 0 | Skip first N URLs after filter |
| `--limit` | `int` |  | Only scrape N URLs total |
| `--code-by` | `string`, repeatable |  | CSS selector for elements to format as inline code. Links inside preserved as markdown links between code spans |
| `--force` | flag |  | Skip cache, re-scrape all |
| `--dry-run` | flag |  | Print matched URLs, don't fetch |
| `--output` | `string` | `.` | Output directory |

## Selectors

CSS-like syntax. Tool converts to a regex that finds the opening tag and captures to the matching close tag.

When no `--selector` or `--match` is given, auto-detect tries this chain in order:

```
article, main, .content, #content, .post, .entry, .document, body
```

| Selector | Matches |
|---|---|
| `.foo` | any element with class `foo` |
| `#bar` | element with id `bar` |
| `div` | tag `div` |
| `div.foo` | `div` with class `foo` |
| `div#bar.baz` | `div` with id `bar` and class `baz` |

If matched element sits inside an `<article>` with a `<header>` tag before it (blog pages), the full article is captured including the H1 title and date outside the content container.

Use `--match` when CSS selector is not precise enough:

```bash
--match='<div class="content">([\s\S]*?)</article>'
```

## HTML to Markdown features

Built-in automatic transformations (no flags needed):

| Source HTML | Output |
|---|---|
| `<h3 class="property">...<a>link</a>...</h3>` | `` `text before`[link](url)`text after` `` — code split around links |
| `theme-admonition-note, -tip, -warning, etc.` | `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` — GFM alerts |
| `<pre class="prism-code language-ts">` | ` ```ts ` — language class preserved on code fence |
| `<hr>` | `---` |
| `<br>` inside `<pre>` | newlines preserved |

Use `--code-by="h3.property"` to mark additional elements for code-split formatting.

### Closing boundary

1. If match is inside an `<article>` with a `<header>` before it, capture full article
2. If `<article>` exists after match, capture to `</article>`
3. Otherwise, capture to matching `</TAG>` with balanced nesting

## Caching & incremental

Sitemap stored as `sitemap.xml` in output directory.

```
fetch sitemap
  |-- no cache → scrape all
  |-- cache exists:
       |-- sitemap changed → update cache, scrape only new URLs
       |-- sitemap same → check .md files on disk
            |-- all present → "Up-to-date. Use --force to re-scrape."
            |-- some missing → scrape only missing
```

No files are ever deleted. Only created or overwritten.

## Concurrency

Fires N requests in parallel, waits for all to finish, then sleeps `interval` ms before next batch.

## Architecture

```
scripts/cli.ts        arg parsing, orchestration
├── lib/fetchHtml.ts  fetch URL → string
├── lib/extract.ts    CSS selector → regex, content extraction
├── lib/convert.ts    spawn Rust binary for HTML → MD
├── lib/frontmatter.ts  YAML frontmatter
├── lib/linkRewrite.ts  rewrite internal links to relative .md
├── lib/save.ts       mkdir + write file
├── lib/sitemap.ts    fetch/parse/cache/diff sitemap

rust-converter/       Rust binary: stdin HTML → stdout MD
  turndown-cdp + scraper (html5ever)
```

## Examples

### Figma plugin docs

```bash
scrape \
  --sitemap="https://developers.figma.com/sitemap.xml" \
  --selector="div.theme-doc-markdown.markdown" \
  --selector="div#__blog-post-container.markdown" \
  --code-by="h3.property" \
  --url-base="https://developers.figma.com/docs/plugins/" \
  --concurrent=10 \
  --interval=200 \
  --output="./figma-docs"
```

### Docusaurus site

```bash
scrape \
  --sitemap="https://docs.example.com/sitemap.xml" \
  --selector="div.theme-doc-markdown" \
  --url-base="https://docs.example.com/docs/" \
  --output="./docs"
```

### Generic blog

```bash
scrape \
  --sitemap="https://blog.example.com/sitemap.xml" \
  --selector="article.post-content" \
  --url-base="https://blog.example.com/" \
  --concurrent=5 \
  --limit=50 \
  --output="./blog"
```

## Related

- [turndown-node fork](https://github.com/FrameMuse/turndown-node) — Rust HTML-to-MD converter used as backend
- [turndown-cdp](https://crates.io/crates/turndown-cdp) — Rust crate for Markdown conversion
