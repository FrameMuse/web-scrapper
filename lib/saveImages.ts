import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
} from "./image-common.ts";
export { IMAGE_EXTENSIONS, extensionFromMime, imageLocalPath } from "./image-common.ts";
import { log } from "./runLogger.ts";
import type { LinkDb } from "./linkDb.ts";

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

function shortHash(s: string): string {
  return createHash("md5").update(s).digest("hex").slice(0, 8);
}

function parseAttrs(attrs: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) {
    result[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  return result;
}

export function preprocessImages(
  html: string,
  pageUrl: string,
  outputDir: string,
  enqueue: (url: string, width?: number, height?: number, alt?: string) => void,
): string {
  // 1. Process <img>, <source> tags, and inline data:image URLs
  html = html.replace(
    /<(img|source)\b([^>]*?)>/gi,
    (match: string, tag: string, attrs: string) => {
      const a = parseAttrs(attrs);

      if (tag.toLowerCase() === "source") {
        const srcset = (a.srcset || "").replace(/&amp;/g, "&");
        if (srcset) {
          const best = pickHighestRes(srcset);
          if (best) {
            const resolved = resolveUrl(best, pageUrl);
            if (resolved && isImageUrl(resolved)) {
              enqueue(resolved);
            }
          }
        }
        return match;
      }

      // <img> tag
      const src = (a.src || "").replace(/&amp;/g, "&");
      const dataSrc = (a["data-src"] || "").replace(/&amp;/g, "&");
      const width = parseInt(a.width || "");
      const height = parseInt(a.height || "");
      const alt = a.alt || "";

      // Handle data:image inline — decode + save + replace src
      if (src.startsWith("data:image/") && !dataSrc) {
        const b64m = src.match(/^data:image\/([a-z+]+);base64,([^"]+)/);
        if (b64m) {
          const ext = b64m[1] === "svg+xml" ? ".svg" : "." + b64m[1].replace("+xml", "");
          const raw = Buffer.from(b64m[2], "base64");
          const hash = shortHash(raw.toString("base64"));
          const localPath = `_data/${hash}${ext}`;
          const fullPath = join(outputDir, "images", "_data", `${hash}${ext}`);
          mkdirSync(dirname(fullPath), { recursive: true });
          if (!existsSync(fullPath)) writeFileSync(fullPath, raw);
          match = match.replace(/src="[^"]*"/, `src="${localPath}"`);
        }
        return match;
      }

      // Normal image (or data-src replaces data:image placeholder)
      const url = (dataSrc && (isPlaceholder(src, width, height) || src.startsWith("data:"))) ? dataSrc : src;

      if (url && !url.startsWith("data:") && !url.startsWith("#")) {
        const resolved = resolveUrl(url, pageUrl);
        if (resolved && isImageUrl(resolved)) {
          const sizeOk = meetsMinSize(width || undefined, height || undefined);
          if (sizeOk !== false) {
            enqueue(resolved, width || undefined, height || undefined, alt);
          }
        }
        if (url === dataSrc) {
          match = match.replace(/src="[^"]*"/, `src="${resolved ?? url}"`);
        }
      }

      // srcset (responsive images)
      const srcset = (a.srcset || a["data-srcset"] || "").replace(/&amp;/g, "&");
      if (srcset) {
        const best = pickHighestRes(srcset);
        if (best) {
          const resolved = resolveUrl(best, pageUrl);
          if (resolved && isImageUrl(resolved)) {
            enqueue(resolved);
            if (!a.srcset) {
              match = match.replace(/srcset="[^"]*"/, `srcset="${resolved}"`);
              match = match.replace(/data-srcset="[^"]*"/, "");
            }
          }
        }
      }

      return match;
    },
  );

  // 2. Inline <svg> → hash + save as file + replace with <img>
  html = html.replace(
    /<svg[\s\S]*?<\/svg>/gi,
    (match: string) => {
      const hash = shortHash(match);
      const svgContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + match;
      const fullPath = join(outputDir, "images", "_inline", `${hash}.svg`);
      const dir = dirname(fullPath);
      if (!existsSync(fullPath)) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, svgContent);
      }
      const localPath = `_inline/${hash}.svg`;
      return `<img src="${localPath}" alt="">`;
    },
  );

  return html;
}

function isPlaceholder(src: string, width?: number, height?: number): boolean {
  if (!src) return true;
  if ((width !== undefined && width <= 1) || (height !== undefined && height <= 1)) return true;
  const name = src.toLowerCase();
  return (
    name.includes("placeholder") ||
    /\bpixel\b/.test(name) ||
    name.includes("1x1")
  );
}

function resolveUrl(url: string, base: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

export function rewriteMarkdownImages(
  md: string,
  outputDir: string,
): string {
  return md.replace(
    /!\[([^\]]*)\]\(((?:https?:\/\/)[^)]+)\)/g,
    (_match: string, alt: string, url: string) => {
      if (!isImageUrl(url)) return _match;
      const local = imageLocalPath(outputDir, url);
      // Compute relative path from output dir
      const rel = local.replace(outputDir + "/", "");
      return `![${alt}](${rel})`;
    },
  );
}

// ---- ImageDownloader ----

export class ImageDownloader {
  private worker: Worker | null = null;
  private _seen = new Set<string>();
  private _db: LinkDb | null;
  outputDir: string;
  private referer: string;

  constructor(outputDir: string, referer = "", db?: LinkDb) {
    this.outputDir = outputDir;
    this.referer = referer;
    this._db = db ?? null;
  }

  setDb(db: LinkDb): void { this._db = db; }

  enqueued = 0;
  completed = 0;

  enqueue(url: string): void {
    if (this._seen.has(url)) return;
    this._seen.add(url);
    this.enqueued++;
    this.worker?.postMessage({ type: "enqueue", url });
  }

  start(): void {
    const url = new URL("./imageWorker.ts", import.meta.url).href;
    this.worker = new Worker(url);
    this.worker.postMessage({ type: "init", outputDir: this.outputDir, referer: this.referer });
    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "progress") {
        this.enqueued = data.enqueued;
        this.completed = data.completed;
      } else if (data.type === "error") {
        log("ERROR", data.message);
      } else if (data.type === "timing") {
        log("TIMING", `Image ${data.url}: ${data.ms}ms`, true);
      } else if (data.type === "image-saved" && this._db) {
        this._db.markImageDownloaded(data.url, data.localPath, data.width, data.height, data.format);
      }
    };
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === "done") {
          this.worker!.removeEventListener("message", handler);
          this.worker!.terminate();
          this.worker = null;
          resolve();
        }
      };
      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({ type: "stop" });
    });
  }
}
