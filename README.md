# scrape

Fetch web pages by CSS selector, convert HTML content to Markdown, save as `.md` files with frontmatter.

Designed for sitemap-driven batch scraping, BFS link crawling, and Cloudflare-bypassing Chrome sessions. Built with Bun and Rust (`turndown-cdp`).

## Install

```bash
# clone and build the Rust HTML-to-MD engine (forked)
git clone https://github.com/FrameMuse/turndown-node ~/github/myforks/turndown-node
cd ~/github/myforks/turndown-node && cargo build --release

# build the Rust converter
cd ~/github/mylibraries/web-scrapper/rust-converter
cargo build --release

# add alias
echo 'alias scrape="bun ~/github/mylibraries/web-scrapper/scripts/cli.ts"' >> ~/.bashrc
```

## Modes

| Mode | Triggers | Output |
|---|---|---|
| Pipe | No `--` flags | Markdown to stdout |
| File | Any `--` flag | `.md` files to `--output` dir |
| Sitemap batch | `--sitemap` | Batch from sitemap XML |
| Follow links | `--follow-links` | BFS crawl from seed URL |

```bash
# pipe
scrape https://site.com/page > page.md

# file
scrape --selector=".content" --url-base="https://site.com/docs/" https://site.com/page

# sitemap
scrape --sitemap="https://site.com/sitemap.xml" --selector=".content" --url-base="https://site.com/docs/" --output="./docs"

# follow links
scrape https://site.com/ --follow-links --selector=".content" --url-base="https://site.com/" --output="./docs"
```

## Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--selector` | string, repeatable | auto-detect | CSS selector for content container. Tried in order, first match wins |
| `--code-by` | string, repeatable | — | CSS selector for elements to format as inline code. Links inside preserved as markdown links between code spans |
| `--match` | string | — | Explicit regex with capture group. Skips CSS conversion |
| `--exclude` | string, repeatable | — | Regex patterns. URLs matching any pattern are not added to crawl queue |
| `--url-base` | string | required | Full URL prefix to strip when computing relative `.md` paths |
| `--url-filter` | string | `--url-base` | Only scrape URLs starting with this prefix |
| `--sitemap` | string | — | Sitemap XML URL for batch scraping |
| `--follow-links` | flag | — | BFS crawl from seed URL. Discover links from each page, deduplicate by normalized URL |
| `--concurrent` | int | 1 | Pages per batch (tabs in Chrome mode) |
| `--interval` | int | 200 | ms between batches |
| `--offset` | int | 0 | Skip first N URLs after filter |
| `--limit` | int | — | Only scrape N URLs total |
| `--force` | flag | — | Skip cache, re-scrape all |
| `--dry-run` | flag | — | Print matched URLs, don't fetch |
| `--chrome` | flag | — | Enable headed Chrome with CDP tab pool (bypasses Cloudflare captcha) |
| `--output` | string | `.` | Output directory |

### Tilde expansion

`--output`, `--url-base`, and other path flags expand `~` to `$HOME` automatically.

## Link filtering

Applied automatically to all discovered links (in both sitemap and follow-links modes):

| Filter | Method | What it skips |
|---|---|---|
| Media extension | URL path check | `.jpg .jpeg .png .gif .svg .webp .bmp .ico .mp4 .webm .avi .mov .mkv .mp3 .wav .ogg .flac .pdf .doc .docx .zip .rar .7z .tar .gz .css .js .json .xml .rss .atom` |
| MIME HEAD | HTTP HEAD → Content-Type | `image/*`, `video/*`, `audio/*` (cached per URL) |
| `--exclude` | Regex on resolved URL | User-defined patterns |
| `--url-filter` | `startsWith` | URLs outside target scope |

## Selectors

CSS-like syntax. Tool converts to a regex that finds the opening tag and captures to matching close tag.

| Selector | Matches |
|---|---|
| `.foo` | any element with class `foo` |
| `#bar` | element with id `bar` |
| `div` | tag `div` |
| `div.foo` | `div` with class `foo` |
| `div#bar.baz` | `div` with id `bar` and class `baz` |

If matched element sits inside an `<article>` with a `<header>` before it, the full article is captured (includes H1 title and date outside the content container).

### Auto-detect chain

When no `--selector` given: `article, main, .content, #content, .post, .entry, .document, body`

### Closing boundary

1. If match is inside an `<article>` with a `<header>` before it → capture full article
2. If `<article>` exists after match → capture to `</article>`
3. Otherwise → capture to `</TAG>` with balanced nesting

## HTML to Markdown features

Built-in automatic transformations (no flags needed):

| Source HTML | Output |
|---|---|
| `<h3 class="property">...<a>link</a>...</h3>` | `` `text before`[link](url)`text after` `` — code split around links |
| `theme-admonition-note, -tip, -warning, etc.` | `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` — GFM alerts |
| `<pre class="prism-code language-ts">` | ` ```ts ` — language class preserved on code fence |
| `<hr>` | `---` |
| `<br>` inside `<pre>` | newlines preserved |
| `<img>` | `![alt](src)` — standard markdown image syntax |

Use `--code-by="h3.property"` to mark additional elements for code-split formatting.

## Chrome CDP Tab Pool

When `--chrome` is active:

1. One headed Chrome process with `--remote-debugging-port=9223`
2. Creates N tabs via `Target.createTarget` (`--concurrent=N`)
3. Each tab has its own CDP WebSocket connection
4. `Page.navigate` → listen for `Network.responseReceived`
5. If MIME type `image/*` → return empty (skip)
6. If Cloudflare challenge detected → poll `document.title` every 1s until it changes
7. Shared profile directory → cookies persist across all tabs (captcha solved once)

Captcha is solved visually in the browser window. No automated solving.

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

Fires N requests in parallel, waits for all to finish, then sleeps `interval` ms before next batch. In Chrome mode, N tabs in the same browser process.

## Architecture

```
scripts/cli.ts           entry: arg parsing, orchestration
├── lib/fetchHtml.ts     HTTP fetch + Chrome CDP session with tab pool
├── lib/extract.ts       CSS selector → regex, content extraction
├── lib/frontmatter.ts   YAML frontmatter generation
├── lib/linkRewrite.ts   rewrite internal links to relative .md
├── lib/save.ts          mkdir + write file + urlToPath
├── lib/sitemap.ts       fetch/parse/cache/diff sitemap

rust-converter/          Rust binary: stdin HTML → stdout MD
  turndown-cdp + scraper (html5ever)
```

### Dependencies

- **Runtime:** Bun 1.3.14
- **Rust converter:** `turndown-cdp` (forked crate), `scraper` (html5ever-based HTML parser)
- **Chrome:** `google-chrome-stable` (optional, for Cloudflare bypass)

### Fork

The Rust converter uses a forked version of `turndown-node` at `~/github/myforks/turndown-node` (https://github.com/FrameMuse/turndown-node). Changes include:
- `<br>` → newlines inside code blocks
- List items with only inline content use `collect_inlines` instead of `convert_children`
- `escape_markdown` no longer escapes `!`, `[`, `]` (needed for GFM alerts and admonitions)
- Docusaurus admonitions → GFM alert blockquotes

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

### Fandom wiki with Chrome

```bash
scrape https://companyofheroes.fandom.com/wiki/Company_of_Heroes_Wiki \
  --chrome \
  --follow-links \
  --selector="main" \
  --exclude="/wiki/(File|Special|Category|User):" \
  --url-base="https://companyofheroes.fandom.com/wiki/" \
  --url-filter="https://companyofheroes.fandom.com/wiki/" \
  --concurrent=5 \
  --interval=300 \
  --output="./coh1"
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

## Test suite

88 tests across 8 files:

| File | Tests | Coverage |
|---|---|---|
| `tests/extract.test.ts` | 18 | CSS parsing, regex, metadata, nested tags |
| `tests/linkRewrite.test.ts` | 9 | Relative paths, fragments, root index |
| `tests/save.test.ts` | 8 | urlToPath with various URL patterns |
| `tests/frontmatter.test.ts` | 5 | YAML rendering, empty fields |
| `tests/sitemap.test.ts` | 6 | URL diff logic |
| `tests/cli.test.ts` | 14 | Arg parsing, pipe/file mode, code-by, exclude |
| `tests/integration.test.ts` | 16 | Real HTML fixtures, Figma pages, code-by |
| `tests/crawl.fixture.test.ts` | 12 | Media filters, exclude, captcha detection, MIME guard |

```bash
bun test
```

Pre-commit hook runs `bun test` automatically (`.githooks/pre-commit`).

## Related

- [turndown-node fork](https://github.com/FrameMuse/turndown-node) — Rust HTML-to-MD converter used as backend
- [turndown-cdp](https://crates.io/crates/turndown-cdp) — Rust crate for Markdown conversion
- [scraper](https://crates.io/crates/scraper) — Rust HTML parser (html5ever)
