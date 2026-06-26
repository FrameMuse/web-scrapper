import { log } from "./runLogger"

export const MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
  ".mp4", ".webm", ".avi", ".mov", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".pdf", ".doc", ".docx", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
])

export function hasMediaExtension(url: string): boolean {
  const path = new URL(url).pathname
  const pathEnding = path.substring(path.lastIndexOf(".")).toLowerCase()
  if (!pathEnding) return false

  return MEDIA_EXTENSIONS.has(pathEnding)
}

/** No trailing slash appended, just cleanup URL. */
export function normalizeUrl(u: string): string {
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.substring(0, hashIdx);

  return u.replace(/\/+$/, "")
}

export function extractAllRawLinks(
  html: string,
  baseUrl: string,
  urlFilter?: string,
  skipQuery = false,
): Array<{ original: string; normalized: string }> {
  const seen = new Set<string>();
  
  const raw: Array<{ original: string; normalized: string }> = [];
  const re = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let m: RegExpExecArray | null;
  let href = ""
  while ((m = re.exec(html)) !== null) {
    try {
      href = m[1] ?? m[2];
      if (!href) continue;

      const resolved = new URL(href, baseUrl).href;
      const clean = skipQuery ? resolved.replace(/\?.*$/, "") : resolved;
      const normalized = normalizeUrl(clean);
      if (!urlFilter || normalized.startsWith(normalizeUrl(urlFilter))) {
        if (seen.has(normalized)) continue
        seen.add(normalized);
        
        raw.push({ original: resolved, normalized });
      }
    } catch (error) {
      log("WARN", `URL parsing/encoding failed during extraction: ${href}; ${error}`);
    }
  }


  return raw
}
