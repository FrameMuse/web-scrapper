import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";

export const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

export function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    // Check if any path segment (before query/hash) has an image extension
    // Handles: /file.png, /file.png/revision/latest, /file.png?w=200
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

export function pickHighestRes(srcset: string): string {
  const candidates: Array<{ url: string; priority: number }> = [];
  const re = /(https?:\/\/[^\s,]+)\s*(\d+[wx]|\d+\.?\d*x)?/gi;
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

export function imageLocalPath(outputDir: string, url: string): string {
  const u = new URL(url);
  const host = u.hostname;
  let path = u.pathname.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (path === "") path = "/index";

  const segments = path.split("/");
  const extIdx = segments.findIndex((seg) =>
    [...IMAGE_EXTENSIONS].some((ext) => seg.toLowerCase().endsWith(ext)),
  );

  if (extIdx === -1) {
    return join(outputDir, "images", host, path);
  }

  const extSeg = segments[extIdx];
  const ext = [...IMAGE_EXTENSIONS].find((e) => extSeg.toLowerCase().endsWith(e))!;
  const baseName = extSeg.slice(0, -ext.length);

  const dirSegments = segments.slice(0, extIdx);
  const fileSegments = [baseName, ...segments.slice(extIdx + 1)].filter(Boolean);
  const flatName = fileSegments.join("_") + ext;

  const dirPath = dirSegments.length > 0 ? dirSegments.join("/") : "";
  return join(outputDir, "images", host, dirPath, flatName);
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
  // 1. Process <img> tags
  html = html.replace(
    /<img\b([^>]*?)>/gi,
    (match: string, attrs: string) => {
      const src = attrValue(attrs, "src").replace(/&amp;/g, "&");
      const dataSrc = attrValue(attrs, "data-src").replace(/&amp;/g, "&");
      const width = parseInt(attrValue(attrs, "width") || "");
      const height = parseInt(attrValue(attrs, "height") || "");

      // If src is a placeholder/data-url and data-src exists, use data-src
      const url = (dataSrc && (isPlaceholder(src) || src.startsWith("data:"))) ? dataSrc : src;

      if (url && !url.startsWith("data:") && !url.startsWith("#")) {
        const resolved = resolveUrl(url, pageUrl);
        if (resolved && isImageUrl(resolved)) {
          const sizeOk = meetsMinSize(width || undefined, height || undefined);
          if (sizeOk !== false) {
            enqueue(resolved);
          }
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
          }
        }
      }

      return match;
    },
  );

  // 2. Process <source srcset> inside <picture>
  html = html.replace(
    /<source\b([^>]*?)>/gi,
    (match: string, attrs: string) => {
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
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = re.exec(attrs);
  return m ? m[1] : "";
}

function isPlaceholder(src: string): boolean {
  if (!src) return true;
  const name = src.toLowerCase();
  return (
    name.includes("placeholder") ||
    /\bpixel\b/.test(name) ||
    name.includes("1x1") ||
    name === "data:image/gif;base64,r0lgodlhaqabaiaiaaaaapexnsyucmrib+ggoddwaaaaaaaabaaeaibaeaaa======" ||
    name === "data:image/gif;base64,r0lgodlhaqabaaap///////yf5baeeaaalaaaaaaabaaaiaaaiateaoaw=="
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

  constructor(outputDir: string) {
    this.outputDir = outputDir;
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
    this.worker.postMessage({ type: "init", outputDir: this.outputDir });
    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "progress") {
        this.enqueued = data.enqueued;
        this.completed = data.completed;
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
