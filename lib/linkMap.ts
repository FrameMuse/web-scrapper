import { readFileSync, writeFileSync, existsSync } from "fs";

export interface LinkEntry {
  visited: boolean;
  processed: boolean;
  contentType: string | null;
}

export type LinkMap = Record<string, LinkEntry>;

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".rss": "application/rss+xml",
  ".atom": "application/atom+xml",
};

export function inferContentType(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
      if (path.endsWith(ext)) return mime;
    }
  } catch {}
  return null;
}

export function addToMap(map: LinkMap, urls: string[]): void {
  for (const url of urls) {
    if (map[url]) continue;
    map[url] = {
      visited: false,
      processed: false,
      contentType: inferContentType(url),
    };
  }
}

export function markVisited(map: LinkMap, url: string, contentType?: string): void {
  if (!map[url]) {
    map[url] = { visited: true, processed: false, contentType: contentType ?? null };
    return;
  }
  map[url].visited = true;
  if (contentType) map[url].contentType = contentType;
}

export function markProcessed(map: LinkMap, url: string): void {
  if (!map[url]) {
    map[url] = { visited: false, processed: true, contentType: null };
    return;
  }
  map[url].processed = true;
}

export function loadLinkMap(path: string): LinkMap {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function saveLinkMap(path: string, map: LinkMap): void {
  // Write atomically via temp file
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2), "utf-8");
  writeFileSync(path, readFileSync(tmp), "utf-8");
}
