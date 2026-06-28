# scrape

Fetch web pages by CSS selector, convert HTML content to Markdown, save as `.md` files with frontmatter.

Designed for sitemap-driven batch scraping, BFS link crawling, and Cloudflare-bypassing Chrome sessions. Built with Bun and SQLite.

## Install

```bash
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
| `--code-by` | string, repeatable | — | CSS selector for elements to format as inline code |
| `--match` | string | — | Explicit regex with capture group. Skips CSS conversion |
| `--exclude` | string, repeatable | — | Regex patterns. URLs matching any pattern excluded from crawl queue |
| `--url-base` | string | required | Full URL prefix to strip for relative `.md` paths |
| `--url-filter` | string | `--url-base` | Only scrape URLs starting with this prefix |
| `--sitemap` | string | — | Sitemap XML URL for batch scraping |
| `--follow-links` | flag | — | BFS crawl from seed URL |
| `--concurrent` | int | 1 | Pages per batch (tabs in Chrome mode) |
| `--interval` | int | 200 | ms between batches |
| `--offset` | int | 0 | Skip first N URLs after filter |
| `--limit` | int | — | Only scrape N URLs total |
| `--force` | flag | — | Skip cache, re-scrape all |
| `--dry-run` | flag | — | Print matched URLs, don't fetch |
| `--chrome` | flag | — | Enable headed Chrome with CDP tab pool |
| `--output` | string | `.` | Output directory |
| `--save-images` | flag | — | Download images via Worker thread, rewrite markdown links to local paths |
| `--build-map` | flag | — | Track crawl state in SQLite DB + export sitemap.json |
| `--skip-query` | flag | — | Strip query strings from URLs for dedup and map keys |

### Tilde expansion

`--output` and other path flags expand `~` to `$HOME` automatically.

## Link filtering

Applied automatically to all discovered links:

| Filter | Method | What it skips |
|---|---|---|
| Media extension | URL path check | `.jpg .jpeg .png .gif .svg .webp .bmp .ico .mp4 .webm .avi .mov .mkv .mp3 .wav .ogg .flac .pdf .doc .docx .zip .rar .7z .tar .gz .css .js .json .xml .rss .atom` |
| MIME HEAD | HTTP HEAD → Content-Type | `image/*`, `video/*`, `audio/*` (cached per URL) |
| `--exclude` | Regex on resolved URL | User-defined patterns |
| `--url-filter` | `startsWith` | URLs outside target scope |

## Selectors

CSS-like syntax. Converts to regex that finds opening tag and captures to matching close tag.

| Selector | Matches |
|---|---|
| `.foo` | any element with class `foo` |
| `#bar` | element with id `bar` |
| `div` | tag `div` |
| `div.foo` | `div` with class `foo` |
| `div#bar.baz` | `div` with id `bar` and class `baz` |

### Auto-detect chain

When no `--selector` given: `article, main, .content, #content, .post, .entry, .document, body`

## HTML to Markdown features

| Source HTML | Output |
|---|---|
| `<h3 class="property">...<a>link</a>...</h3>` | `` `text before`[link](url)`text after` `` |
| `theme-admonition-note, -tip, -warning` | `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` |
| `<pre class="prism-code language-ts">` | `` ```ts `` |
| `<hr>` | `---` |
| `<br>` inside `<pre>` | newlines preserved |
| `<img>` | `![alt](src)` |

## Chrome CDP Tab Pool

When `--chrome` is active:

1. One headed Chrome process with `--remote-debugging-port=9223`
2. Creates N tabs via `Target.createTarget` (`--concurrent=N`)
3. Each tab has its own CDP WebSocket connection
4. `Page.navigate` → listen for `Network.responseReceived`
5. If redirected to different host (auth, sign-in) → return empty HTML immediately
6. If Cloudflare challenge detected → poll `document.title` until it changes
7. Shared profile directory → cookies persist across tabs
8. Image requests blocked in Chrome; fetched separately via Worker

## Image downloads

`--save-images` downloads page images in a dedicated Worker thread (separate V8 isolate). Images are downloaded via direct HTTP fetch, not through Chrome. Saves to `<outputDir>/images/<host>/<path>` with flattened CDN paths. Supports:
- `data-src` / `srcset` lazy-load resolution
- Inline `<svg>` extraction
- data:URL decoding
- Size filtering (< 128x128 skipped)
- Progress counter in crawl status bar

## Sitemap & resume

`--build-map` tracks crawl state in a SQLite database (`sitemap.sqlite.db`). On completion, exports a portable `sitemap.json`.

### SQLite schema

```sql
-- links table: tracks discovered URLs and their processing state
CREATE TABLE links (
  url TEXT PRIMARY KEY,           -- normalized URL
  ct TEXT NOT NULL DEFAULT '',    -- content type
  visited INTEGER DEFAULT 0,      -- page has been fetched
  processed INTEGER DEFAULT 0     -- content has been saved as .md
);

-- logs table: run-scoped diagnostic logs
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,             -- ERROR, WARN, INFO, TIMING
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- migrations table: auto-applied schema updates
CREATE TABLE _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
```

### sitemap.json format

```json
{
  "urlBase": "https://site.com/docs/",
  "entries": [
    ["getting-started", "text/html", 3],
    ["api/reference", "text/html", 1],
    ["changelog", "text/html", 0]
  ]
}
```

Each entry is `[uri, contentType, flags]` where flags are bitwise:
- `0` = discovered only
- `1` = visited (fetched)
- `2` = processed (saved as .md)
- `3` = visited + processed

URIs are relative to `urlBase`. To resume a crawl: `importJson` into a fresh DB, then run the resume flow.

### Resume

Re-run the same command with `--build-map`. The DB is loaded, visited/processed sets are reconstructed, and unprocessed URLs continue in the crawl queue. No duplicate work.

## Logging

Every crawl gets a unique run ID (`YYYYMMDD-HHMMSS-RAND`). Errors and timing messages are logged to the `logs` table in the SQLite DB, tagged by run ID.

```sql
-- View errors for a specific run
SELECT * FROM logs WHERE run_id='20260625-163000-A1B2' AND level='ERROR' ORDER BY id;

-- View all timing for a run
SELECT * FROM logs WHERE run_id='20260625-163000-A1B2' AND level='TIMING' ORDER BY id;
```

## Migrations

Schema changes live in `lib/migrations/*.sql`. Files are applied in sorted order on DB open. The `_migrations` table tracks which have been applied.

```bash
lib/migrations/
  001_create_links.sql    # links table
  002_create_logs.sql     # logs table
```

To add a migration: create `003_<name>.sql` with SQL. The runner applies it automatically on next DB open.

## Architecture

```
scripts/cli.ts                     entry: arg parsing, orchestration
├── lib/fetchHtml.ts               HTTP fetch + Chrome CDP tab pool
├── lib/extract.ts                 CSS selector → regex, content extraction
├── lib/frontmatter.ts             YAML frontmatter generation
├── lib/linkRewrite.ts             rewrite internal links to relative .md
├── lib/save.ts                    mkdir + write file + urlToPath
├── lib/sitemap.ts                 fetch/parse/cache/diff sitemap
├── lib/saveImages.ts              preprocess HTML images, ImageDownloader (Worker manager)
├── lib/imageWorker.ts             Worker thread: download + save images
├── lib/links.ts                   link extraction, normalization, media detection
├── lib/linkMap.ts                 JSON-backed link map (legacy)
├── lib/linkCsv.ts                 fixed-width CSV link map (legacy)
├── lib/linkDb.ts                  SQLite-backed link map (primary)
├── lib/linkFlags.ts               LinkFlags enum (None, Visited, Processed)
├── lib/image-common.ts            shared IMAGE_EXTENSIONS, imageLocalPath, etc.
├── lib/runLogger.ts               run ID generation, DB-backed log forwarding
├── lib/migrations/                SQL migration files
│   ├── 001_create_links.sql       links table
│   └── 002_create_logs.sql        logs table
│

```

### Dependencies

- **Runtime:** Bun 1.3.14
- **HTML-to-MD:** `html2md-js` (DOM-to-Markdown converter)
- **Chrome:** `google-chrome-stable` (optional, for Cloudflare bypass)
- **SQLite:** built into Bun (`bun:sqlite`)



## Examples

### Fandom wiki with Chrome + build map + images

```bash
scrape https://companyofheroes.fandom.com/wiki/Company_of_Heroes_Wiki \
  --chrome \
  --follow-links \
  --selector="main" \
  --exclude="/wiki/(File|User|Help|Talk|Template|MediaWiki|Module|Thread)(_[^/]+)*:" \
  --exclude="action=history" \
  --url-base="https://companyofheroes.fandom.com/wiki/" \
  --concurrent=5 \
  --interval=300 \
  --output="./coh1" \
  --build-map \
  --save-images
```

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

## Test suite

286 tests across 16 files:

| File | Tests | Coverage |
|---|---|---|
| `tests/extract.test.ts` | 18 | CSS parsing, regex, metadata, nested tags |
| `tests/saveImages.test.ts` | 52 | image detection, path computation, preprocessImages, ImageDownloader lifecycle |
| `tests/linkDb.test.ts` | 16 | SQLite CRUD, visited/processed sets, resume, export/import round-trip |
| `tests/imageWorker.test.ts` | 9 | Worker message protocol, download, error handling, batch processing |
| `tests/fetchHtml.test.ts` | 12 | isChallengePage, HTTP fetch with mocked global.fetch |
| `tests/linkMap.test.ts` | 26 | JSON map CRUD, originalUrl storage, resume logic |
| `tests/linkCsv.test.ts` | 13 | fixed-width CSV operations, dedup, in-place update |
| `tests/cli.test.ts` | 47 | parseArgs, expandTilde, isExcluded, filterUrls, stripExcludedLinks |
| `tests/linkPerf.test.ts` | 23 | CSV vs JSON vs SQLite benchmarks (write, read, update, append, resume, file size) |
| `tests/integration.test.ts` | 16 | Real HTML fixtures, Figma pages, code-by |
| Others | 54 | linkRewrite, frontmatter, save, sitemap, crawl fixtures |

```bash
bun test
```

Pre-commit hook runs `bun test` automatically (`.githooks/pre-commit`).
