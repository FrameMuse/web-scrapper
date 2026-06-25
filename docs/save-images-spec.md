# `--save-images` Feature Spec

## Flag

`--save-images` — boolean. Works with any mode (`--follow-links`, `--sitemap`, single page, pipe).

## Storage

### File path

Images are saved under `<outputDir>/images/` mirroring the URL's host + pathname.

```
URL:  https://static.wikia.nocookie.net/companyofheroes/images/a/a8/file.jpg
PATH: <outputDir>/images/static.wikia.nocookie.net/companyofheroes/images/a/a8/file.jpg
```

If the URL pathname has no file extension, append one from the response `content-type` header:

| Content-Type | Extension |
|---|---|
| `image/jpeg` | `.jpg` |
| `image/png` | `.png` |
| `image/webp` | `.webp` |
| `image/svg+xml` | `.svg` |
| `image/gif` | `.gif` |

### Inline SVG

Inline `<svg>...</svg>` elements are saved as separate `.svg` files.

```
PATH: <outputDir>/images/_inline/<md5_of_content>.svg
```

The original `<svg>` in HTML is replaced with `<img src=".../_inline/<hash>.svg">` before the Rust converter runs.

### Data URLs

`data:image/...` URLs are decoded from base64 and saved as files.

```
PATH: <outputDir>/images/_data/<md5_of_raw_data>.<ext>
```

The original `src="data:..."` is replaced with `src=".../_data/<hash>.ext"` before the Rust converter runs.

## Image sources (extraction order)

1. **`<img src="...">`** — enqueue the `src` URL
   - If `src` looks like a placeholder (e.g., `placeholder.gif`, `pixel.gif`, `data:image/gif;base64,...`) AND `data-src` exists, use `data-src` instead
   - Capture `width` and `height` attributes for size filtering
   
2. **`<img srcset="...">`** — parse descriptors, pick highest resolution URL, enqueue it

3. **`<picture>` → `<source srcset="...">`** — parse each `<source>`'s `srcset`, pick the highest resolution from all sources, enqueue

4. **Inline `<svg>...</svg>`** — extract outerHTML, hash content, save as `_inline/<hash>.svg`, replace with `<img>`

5. **`data:image/...`** — decode base64, hash raw bytes, save as `_data/<hash>.<ext>`, replace `src`

## Background queue

Images are **enqueued** synchronously during page processing. Downloads happen in a **background interval**:

| Param | Value |
|---|---|
| Interval | 500ms |
| Batch size | 20 URLs (parallel via `Promise.allSettled`) |
| HTTP | Plain `fetch()` (no Chrome) |
| No wait | The batch runs detached — the main crawl loop does not wait for images to finish downloading |

### Download flow per URL

1. If file exists at `<localPath>` → skip (re-crawl safety)
2. `HEAD` or `GET` → check `content-type` starts with `image/` → skip if not
3. If no `width`/`height` from HTML attrs: download, check dimensions via `image-size` → skip if either < 128
4. Write to `<localPath>` with `mkdirSync(dirname, recursive)`

## Size filtering (128x128 minimum)

| Scenario | Method |
|---|---|
| `<img width="200" height="200">` (both attrs present) | Skip download if both < 128 |
| `<img width="32">` (only width, or only height) | If either known attr < 128 → skip |
| No dimension attrs, or `<source>` | Download then check with `image-size` |
| Inline `<svg>` | No size filter (SVG viewport is not reliable from attrs alone) |
| Data URL `<img src="data:...">` | Decode then check with `image-size` |

## Markdown rewriting

After `rewriteLinks()` (which handles `.md` internal links), an additional pass rewrites image URLs:

```
Input:  ![A photo](https://cdn.example.com/photo.jpg)
Output: ![A photo](images/cdn.example.com/photo.jpg)
```

The local path is **deterministic** — computed from URL only, no need to wait for download. If download fails, the original URL stays in the markdown (rewrite is skipped for that URL).

## CDP interaction

When `--save-images` is active, remove `"Image"` from `blockedTypes` in the CDP request blocker:

```typescript
const blockedTypes = new Set([
  "Font", "Media", "WebSocket", "Manifest", "Stylesheet",
  // "Image" NOT blocked when --save-images is active
]);
```

Chrome loads images → browser disk cache may speed up subsequent HTTP fetches for same-origin images.

## Files to create/modify

| File | Action |
|---|---|
| `lib/saveImages.ts` | **Create** — `ImageDownloader` class + helpers |
| `scripts/cli.ts` | **Modify** — add flag, wire pre/post-processing |
| `lib/fetchHtml.ts` | **Modify** — conditional `"Image"` in blockedTypes |
| `tests/saveImages.test.ts` | **Create** — unit tests |
| `tests/fixtures/crawl/images-page.html` | **Create** — fixture with diverse image markup |

## Edge cases

| Case | Handling |
|---|---|
| Duplicate image across pages | `enqueue` dedup by URL `Set` |
| Download fails | Original URL stays in markdown (no rewrite) |
| File already exists | Skip download |
| URL without extension | Append from MIME |
| URL with port | `hostname:8080` in path |
| URL with auth | Strip `user:pass@` from path |
| `base64` decode fails | Skip, leave original `data:` URL |
| Inline SVG with nested elements | Full `<svg>...</svg>` outerHTML saved as-is |

## Dependencies

`npm install image-size` — read image dimensions from buffer headers. Pure JS, no native deps.
