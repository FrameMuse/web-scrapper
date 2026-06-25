import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import sizeOf from "image-size";

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
  return join(outputDir, "images", host, path);
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
      const src = attrValue(attrs, "src");
      const dataSrc = attrValue(attrs, "data-src");
      const width = parseInt(attrValue(attrs, "width") || "");
      const height = parseInt(attrValue(attrs, "height") || "");

      // If src is a placeholder and data-src exists, use data-src
      const url = (dataSrc && isPlaceholder(src)) ? dataSrc : src;

      if (url && !url.startsWith("data:") && !url.startsWith("#")) {
        const resolved = resolveUrl(url, pageUrl);
        if (resolved && isImageUrl(resolved)) {
          enqueue(resolved, width || undefined, height || undefined);
        }
      }
      return match;
    },
  );

  // 2. Process <picture> → <source srcset>
  html = html.replace(
    /<picture\b[^>]*?>/gi,
    (match: string) => {
      return match;
    },
  );

  // Extract srcset from source elements inside picture
  // (process after the main replacement loop)
  html = html.replace(
    /<source\b([^>]*?)>/gi,
    (match: string, attrs: string) => {
      const srcset = attrValue(attrs, "srcset");
      if (srcset) {
        const best = pickHighestRes(srcset);
        if (best) {
          enqueue(best);
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
    name.includes("pixel") ||
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
  processed?: Set<string>,
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
  private queue: string[] = [];
  private seen = new Set<string>();
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  enqueued = 0;
  completed = 0;

  enqueue(url: string): void {
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.queue.push(url);
    this.enqueued++;
  }

  start(): void {
    this.processLoop();
  }

  async stop(): Promise<void> {
    this._stopped = true;
    // Wait for queue + active to drain
    while (this.queue.length > 0 || this.active > 0) {
      await Bun.sleep(100);
    }
  }

  private _stopped = false;
  active = 0;

  private async processLoop(): Promise<void> {
    while (!this._stopped || this.queue.length > 0 || this.active > 0) {
      if (this.queue.length === 0) {
        await Bun.sleep(200);
        continue;
      }
      const start = performance.now();
      const batch = this.queue.splice(0, 20);
      this.active += batch.length;
      await Promise.allSettled(batch.map((url) => this.download(url)));
      const elapsed = performance.now() - start;
      if (elapsed < 500) await Bun.sleep(500 - elapsed);
    }
  }

  private async download(url: string): Promise<void> {
    try {
      await this.downloadInternal(url);
    } finally {
      this.active--;
    }
  }

  private async downloadInternal(url: string): Promise<void> {
    const localPath = imageLocalPath(this.outputDir, url);
    const dir = dirname(localPath);

    // Check if file already exists
    if (existsSync(localPath)) return;

    try {
      const res = await fetch(url);
      if (!res.ok) return;

      const ct = res.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) return;

      const buf = Buffer.from(await res.arrayBuffer());

      // Check size
      if (buf.length > 0) {
        try {
          const dims = sizeOf(buf);
          if ((dims.width && dims.width < 128) || (dims.height && dims.height < 128)) {
            return;
          }
        } catch {
          // image-size couldn't parse — save anyway (unknown format edge case)
        }
      }

      // Ensure directory exists
      mkdirSync(dir, { recursive: true });
      writeFileSync(localPath, buf);
      this.completed++;

      // If local path lacks extension, append from MIME
      if (!localPath.match(/\.[a-z0-9]+$/i)) {
        const ext = extensionFromMime(ct);
        if (ext) {
          const extPath = localPath + ext;
          if (!existsSync(extPath)) {
            writeFileSync(extPath, buf);
          }
        }
      }
    } catch {
      // Download failed — skip silently
    }
  }
}
