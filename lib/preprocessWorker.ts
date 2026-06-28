import { mkdir, writeFile, access } from "fs/promises";
import { dirname, join } from "path";
import { createHash } from "crypto";
import {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
  isImageUrl,
  pickHighestRes,
  meetsMinSize,
} from "./image-common.ts";

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

type ImageInfo = { url: string; width?: number; height?: number; alt?: string };

type ReplaceOp = {
  index: number;
  length: number;
  replacement: string;
  promise: Promise<void>;
};

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (data.type !== "process") return;

  const { html, pageUrl, outputDir, id } = data;
  const images: ImageInfo[] = [];
  const ops: ReplaceOp[] = [];

  // Phase 1: <img> and <source> tags
  const tagRe = /<(img|source)\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const match = m[0];
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const a = parseAttrs(attrs);

    if (tag === "source") {
      const srcset = (a.srcset || "").replace(/&amp;/g, "&");
      if (srcset) {
        const best = pickHighestRes(srcset);
        if (best) {
          const resolved = resolveUrl(best, pageUrl);
          if (resolved && isImageUrl(resolved)) {
            images.push({ url: resolved });
          }
        }
      }
      ops.push({ index: m.index, length: match.length, replacement: match, promise: Promise.resolve() });
      continue;
    }

    // <img> tag
    const src = (a.src || "").replace(/&amp;/g, "&");
    const dataSrc = (a["data-src"] || "").replace(/&amp;/g, "&");
    const width = parseInt(a.width || "");
    const height = parseInt(a.height || "");
    const alt = a.alt || "";
    let replacement = match;
    let writePromise: Promise<void> = Promise.resolve();
    const pushImage = (url: string, w?: number, h?: number, al?: string) => {
      images.push({ url, width: w, height: h, alt: al });
    };

    // data:image inline
    if (src.startsWith("data:image/") && !dataSrc) {
      const b64m = src.match(/^data:image\/([a-z+]+);base64,([^"]+)/);
      if (b64m) {
        const ext = b64m[1] === "svg+xml" ? ".svg" : "." + b64m[1].replace("+xml", "");
        const raw = Buffer.from(b64m[2], "base64");
        const hash = shortHash(raw.toString("base64"));
        const localPath = `_data/${hash}${ext}`;
        const fullPath = join(outputDir, "images", "_data", `${hash}${ext}`);
        writePromise = mkdir(dirname(fullPath), { recursive: true })
          .then(() => access(fullPath).catch(() => writeFile(fullPath, raw)));
        replacement = match.replace(/src="[^"]*"/, `src="${localPath}"`);
      }
    } else {
      const url = (dataSrc && (isPlaceholder(src, width, height) || src.startsWith("data:"))) ? dataSrc : src;
      if (url && !url.startsWith("data:") && !url.startsWith("#")) {
        const resolved = resolveUrl(url, pageUrl);
        if (resolved && isImageUrl(resolved)) {
          const sizeOk = meetsMinSize(width || undefined, height || undefined);
          if (sizeOk !== false) {
            pushImage(resolved, width || undefined, height || undefined, alt);
          }
        }
        if (url === dataSrc) {
          replacement = match.replace(/src="[^"]*"/, `src="${resolved ?? url}"`);
        }
      }

      // srcset (responsive images)
      const srcset = (a.srcset || a["data-srcset"] || "").replace(/&amp;/g, "&");
      if (srcset) {
        const best = pickHighestRes(srcset);
        if (best) {
          const resolved = resolveUrl(best, pageUrl);
          if (resolved && isImageUrl(resolved)) {
            pushImage(resolved);
            if (!a.srcset) {
              replacement = match.replace(/srcset="[^"]*"/, `srcset="${resolved}"`);
              replacement = replacement.replace(/data-srcset="[^"]*"/, "");
            }
          }
        }
      }
    }

    ops.push({ index: m.index, length: match.length, replacement, promise: writePromise });
  }

  // Phase 2: inline <svg>
  const svgRe = /<svg[\s\S]*?<\/svg>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = svgRe.exec(html)) !== null) {
    const match = sm[0];
    const hash = shortHash(match);
    const svgContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + match;
    const fullPath = join(outputDir, "images", "_inline", `${hash}.svg`);
    const writePromise = mkdir(dirname(fullPath), { recursive: true })
      .then(() => access(fullPath).catch(() => writeFile(fullPath, svgContent)));
    const replacement = `<img src="_inline/${hash}.svg" alt="">`;
    ops.push({ index: sm.index, length: match.length, replacement, promise: writePromise });
  }

  // Wait for all file writes
  await Promise.all(ops.map((o) => o.promise));

  // Apply replacements in reverse index order to preserve positions
  ops.sort((a, b) => b.index - a.index);
  let result = html;
  for (const { index, length, replacement } of ops) {
    result = result.slice(0, index) + replacement + result.slice(index + length);
  }

  self.postMessage({ type: "result", id, html: result, images });
};
