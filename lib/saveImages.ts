// Types for --save-images feature
// Full implementation TBD — tests describe expected behavior.

export const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

export function isImageUrl(url: string): boolean {
  throw new Error("Not implemented");
}

export function extensionFromMime(mime: string): string {
  throw new Error("Not implemented");
}

/**
 * Parse srcset attribute, return URL of the highest-resolution variant.
 * srcset format: "url 1200w, url 600w" or "url 2x, url 1x"
 */
export function pickHighestRes(srcset: string): string {
  throw new Error("Not implemented");
}

/**
 * Compute local image path mirroring the URL:
 *   <outputDir>/images/<host>/<pathname>
 * If pathname has no extension, do NOT append one (unknown at path-compute time).
 * Strips auth from URL.
 * Strips query and hash (mirrors normalizeUrl behavior for consistency).
 */
export function imageLocalPath(outputDir: string, url: string): string {
  throw new Error("Not implemented");
}

/**
 * Extract image URLs and inline SVGs/data-urls from HTML.
 * Returns modified HTML (with inline SVGs saved as img tags, data-urls rewritten)
 * and feeds discovered URLs to the enqueue callback.
 */
export function preprocessImages(
  html: string,
  pageUrl: string,
  enqueue: (url: string, width?: number, height?: number) => void,
): string {
  throw new Error("Not implemented");
}

/**
 * Find all <img src="...">, <source srcset="...">, <picture>, inline <svg>,
 * and data:image URLs. For each discovered image, call enqueue().
 * For inline <svg> and data: URLs, replace the inline content with a local file
 * reference and return the modified HTML.
 *
 * @param html     — page HTML
 * @param pageUrl  — base URL for resolving relative image URLs
 * @param enqueue  — called for each discoverable image URL
 * @returns        — HTML with inline SVGs and data: URLs replaced by <img> tags
 */
export function processPageImages(
  html: string,
  pageUrl: string,
  enqueue: (url: string, width?: number, height?: number) => void,
): string {
  throw new Error("Not implemented");
}

/**
 * Rewrite markdown image links from absolute URLs to local paths.
 * If a URL was not discovered during HTML processing (not in seen set),
 * it is still computed deterministically.
 *
 * @param md        — markdown body
 * @param outputDir — output directory root
 * @param processed — set of URLs that were enqueued (for consistency check)
 * @returns         — markdown with rewritten image paths
 */
export function rewriteMarkdownImages(
  md: string,
  outputDir: string,
  processed?: Set<string>,
): string {
  throw new Error("Not implemented");
}

/**
 * Check if image dimensions are >= 128x128.
 * If both width and height are known from HTML attrs, use them.
 * If unknown, return null (caller must download and check).
 */
export function meetsMinSize(
  width: number | undefined,
  height: number | undefined,
): boolean | null {
  throw new Error("Not implemented");
}
