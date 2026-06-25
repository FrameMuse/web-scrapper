import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
} from "./image-common.ts";

export { IMAGE_EXTENSIONS, extensionFromMime, imageLocalPath } from "./image-common.ts";

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
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0].url;
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

export function preprocessImages(
  html: string,
  pageUrl: string,
  outputDir: string,
  enqueue: (url: string, width?: number, height?: number) => void,
): string {
  // 1. Process <img> and <source> tags (single pass)
  html = html.replace(
    /<(img|source)\b([^>]*?)>/gi,
    (match: string, tag: string, attrs: string) => {
      if (tag.toLowerCase() === "source") {
        const srcset = attrValue(attrs, "srcset").replace(/&amp;/g, "&");
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

      // <img> tag handling
      const src = attrValue(attrs, "src").replace(/&amp;/g, "&");
      const dataSrc = attrValue(attrs, "data-src").replace(/&amp;/g, "&");
      const width = parseInt(attrValue(attrs, "width") || "");
      const height = parseInt(attrValue(attrs, "height") || "");

      // If src is a placeholder/data-url and data-src exists, use data-src
      const url = (dataSrc && (isPlaceholder(src, width, height) || src.startsWith("data:"))) ? dataSrc : src;

      if (url && !url.startsWith("data:") && !url.startsWith("#")) {
        const resolved = resolveUrl(url, pageUrl);
        if (resolved && isImageUrl(resolved)) {
          const sizeOk = meetsMinSize(width || undefined, height || undefined);
          if (sizeOk !== false) {
            enqueue(resolved);
          }
        }
        // Rewrite src attribute when data-src was used
        if (url === dataSrc) {
          match = match.replace(/src="[^"]*"/, `src="${resolved ?? url}"`);
        }
      }

      // srcset (responsive images)
      const srcset = (attrValue(attrs, "srcset") || attrValue(attrs, "data-srcset")).replace(/&amp;/g, "&");
      if (srcset) {
        const best = pickHighestRes(srcset);
        if (best) {
          const resolved = resolveUrl(best, pageUrl);
          if (resolved && isImageUrl(resolved)) {
            enqueue(resolved);
            // Rewrite srcset attribute when data-srcset was used
            const originalSrcset = attrValue(attrs, "srcset");
            if (!originalSrcset) {
              match = match.replace(/srcset="[^"]*"/, `srcset="${resolved}"`);
              match = match.replace(/data-srcset="[^"]*"/, "");
            }
          }
        }
      }

      return match;
    },
  );

  // 3. Inline <svg> → hash + save as file + replace with <img>
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

  // 4. data:image URLs → decode, save, replace src
  html = html.replace(
    /src="(data:image\/([a-z+]+);base64,([^"]+))"/gi,
    (_match: string, _full: string, mimeSub: string, b64: string) => {
      const ext = mimeSub === "svg+xml" ? ".svg" : "." + mimeSub.replace("+xml", "");
      const raw = Buffer.from(b64, "base64");
      const hash = shortHash(raw.toString("base64"));
      const localPath = `_data/${hash}${ext}`;
      const fullPath = join(outputDir, "images", "_data", `${hash}${ext}`);
      const dir = dirname(fullPath);
      if (!existsSync(fullPath)) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, raw);
      }
      return `src="${localPath}"`;
    },
  );

  return html;
}

function attrValue(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2]) : "";
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
  outputDir: string;
  private referer: string;

  constructor(outputDir: string, referer = "") {
    this.outputDir = outputDir;
    this.referer = referer;
  }

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
        console.error(`\n  ${data.message}`);
      } else if (data.type === "timing") {
        console.error(`\n  Image ${data.url}: ${data.ms}ms`);
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
