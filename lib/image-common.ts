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
