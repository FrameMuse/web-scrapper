export const MEDIA_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
  ".mp4", ".webm", ".avi", ".mov", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".pdf", ".doc", ".docx", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
];

export function isMediaLink(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch { return false; }
}

export function normalizeUrl(u: string): string {
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.substring(0, hashIdx);
  return u.replace(/\/+$/, "") + "/";
}

export function extractAllRawLinks(
  html: string,
  baseUrl: string,
  urlFilter?: string,
  skipQuery = false,
): Array<{ original: string; normalized: string }> {
  const raw: Array<{ original: string; normalized: string }> = [];
  const re = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const href = m[1] ?? m[2];
      if (!href) continue;
      const resolved = new URL(href, baseUrl).href;
      const clean = skipQuery ? resolved.replace(/\?.*$/, "") : resolved;
      const normalized = normalizeUrl(clean);
      if (!urlFilter || normalized.startsWith(normalizeUrl(urlFilter))) {
        raw.push({ original: resolved, normalized });
      }
    } catch {}
  }

  const seen = new Set<string>();
  return raw.filter(({ normalized }) => {
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
