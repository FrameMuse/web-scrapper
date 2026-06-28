import { join } from "path";

export const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);
export const IMAGE_EXTENSIONS_ARRAY = [...IMAGE_EXTENSIONS];

const MIME_EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
};

export function extensionFromMime(mime: string): string {
  return MIME_EXT_MAP[mime] || "";
}

export const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const segments = path.replace(/[?#].*$/, "").split("/");
    for (const seg of segments) {
      for (const ext of IMAGE_EXTENSIONS) {
        if (seg.endsWith(ext)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function pickHighestRes(srcset: string): string {
  const candidates: Array<{ url: string; priority: number }> = [];
  const re = /((?:https?:)?\/\/[^\s,]+)\s*(\d+[wx]|\d+\.?\d*x)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(srcset)) !== null) {
    const url = m[1].replace(/\/+$/, "");
    const desc = (m[2] || "").trim().toLowerCase();
    let priority = 0;
    if (desc.endsWith("w")) priority = parseInt(desc) || 0;
    else if (desc.endsWith("x")) priority = Math.round((parseFloat(desc) || 1) * 1000);
    else priority = 1;
    candidates.push({ url, priority });
  }
  if (candidates.length === 0) return "";
  return candidates.reduce((best, c) => c.priority > best.priority ? c : best).url;
}

export function meetsMinSize(
  width: number | undefined,
  height: number | undefined,
): boolean | null {
  if (width !== undefined && height !== undefined) {
    return width >= 128 && height >= 128;
  }
  if (width !== undefined) return width >= 128 ? null : false;
  if (height !== undefined) return height >= 128 ? null : false;
  return null;
}

export function imageLocalPath(outputDir: string, url: string): string {
  const u = new URL(url);
  const host = u.hostname;
  let path = u.pathname.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (path === "") path = "/index";

  const segments = path.split("/");
  const extIdx = segments.findIndex((seg) =>
    IMAGE_EXTENSIONS_ARRAY.some((ext) => seg.toLowerCase().endsWith(ext)),
  );

  if (extIdx === -1) {
    return join(outputDir, "images", host, path);
  }

  const extSeg = segments[extIdx];
  const ext = IMAGE_EXTENSIONS_ARRAY.find((e) => extSeg.toLowerCase().endsWith(e))!;
  const baseName = extSeg.slice(0, -ext.length);

  const dirSegments = segments.slice(0, extIdx);
  const fileSegments = [baseName, ...segments.slice(extIdx + 1)].filter(Boolean);
  const flatName = fileSegments.join("_") + ext;

  const dirPath = dirSegments.length > 0 ? dirSegments.join("/") : "";
  return join(outputDir, "images", host, dirPath, flatName);
}
