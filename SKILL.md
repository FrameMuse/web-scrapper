---
name: web-scrapper
description: Use when user asks to scrape websites, save pages as markdown, clone documentation, or archive web content. Covers sitemap-based batch scraping, incremental updates, CSS selector extraction, and HTML-to-markdown conversion.
---

## pipe mode (no flags)

```bash
scrape https://site.com/page > page.md
```

## file mode (any `--flag`)

```bash
scrape \
  --sitemap="https://developers.figma.com/sitemap.xml" \
  --selector="div.theme-doc-markdown.markdown" \
  --selector="div#__blog-post-container.markdown" \
  --url-base="https://developers.figma.com/docs/plugins/" \
  --concurrent=10 \
  --interval=200 \
  --output="~/scrapped/some-folder"
```

## flags

| Flag | Description |
|---|---|
| `--selector="CSS"` | repeatable, tried in order, first match wins |
| `--match="REGEX"` | override explicit regex with capture group |
| `--url-base="URL"` | strip prefix for `.md` naming |
| `--url-filter="URL"` | defaults to `--url-base` |
| `--sitemap="URL"` | batch scrape from sitemap |
| `--concurrent=N` | pages per batch (default 1) |
| `--interval=N` | ms between batches (default 200) |
| `--offset=N` | skip first N URLs |
| `--limit=N` | scrape N URLs total |
| `--force` | skip cache, re-scrape all |
| `--dry-run` | preview only |
| `--output="DIR"` | output directory (default `.`) |

## auto-detect selectors

When no `--selector` given: `article, main, .content, #content, .post, .entry, .document, body`

## caching

`sitemap.xml` stored in output dir. Same sitemap on re-run checks for missing `.md` files. Sitemap changed scrapes only new URLs. Exit message "Up-to-date. Use --force to re-scrape."
