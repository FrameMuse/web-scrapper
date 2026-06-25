import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import sizeOf from "image-size";

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

const MIME_EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
};

function extensionFromMime(mime: string): string {
  return MIME_EXT_MAP[mime] || "";
}

const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let outputDir = "";
const queue: string[] = [];
const seen = new Set<string>();
let stopped = false;
let active = 0;
let enqueued = 0;
let completed = 0;

function imageLocalPath(url: string): string {
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

async function downloadInternal(url: string): Promise<void> {
  let localPath = imageLocalPath(url);
  const dir = dirname(localPath);

  if (existsSync(localPath)) return;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CHROME_UA },
    });
    if (!res.ok) return;

    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return;

    const buf = Buffer.from(await res.arrayBuffer());

    if (buf.length > 0) {
      try {
        const dims = sizeOf(buf);
        if ((dims.width && dims.width < 128) || (dims.height && dims.height < 128)) {
          return;
        }
      } catch {}
    }

    if (!localPath.match(/\.[a-z0-9]+$/i)) {
      const ext = extensionFromMime(ct);
      if (ext) localPath += ext;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(localPath, buf);
    completed++;
    self.postMessage({ type: "progress", enqueued, completed });
  } catch {}
}

async function processLoop(): Promise<void> {
  while (!stopped || queue.length > 0 || active > 0) {
    if (queue.length === 0) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const batch = queue.splice(0, 20);
    active += batch.length;
    await Promise.allSettled(batch.map((url) => download(url)));
  }
  self.postMessage({ type: "done" });
}

async function download(url: string): Promise<void> {
  try {
    await downloadInternal(url);
  } finally {
    active--;
  }
}

self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  switch (data.type) {
    case "init":
      outputDir = data.outputDir;
      processLoop();
      break;
    case "enqueue":
      if (seen.has(data.url)) return;
      seen.add(data.url);
      queue.push(data.url);
      enqueued++;
      self.postMessage({ type: "progress", enqueued, completed });
      break;
    case "stop":
      stopped = true;
      break;
  }
};
