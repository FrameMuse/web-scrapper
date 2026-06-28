import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import sizeOf from "image-size";
import {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
  CHROME_UA,
} from "./image-common.ts";

let outputDir = "";
let referer = "";
const queue: string[] = [];
const seen = new Set<string>();
let stopped = false;
let active = 0;
let enqueued = 0;
let completed = 0;

async function downloadInternal(url: string): Promise<void> {
  let localPath = imageLocalPath(outputDir, url);
  const dir = dirname(localPath);

  if (existsSync(localPath)) {
    completed++;
    self.postMessage({ type: "progress", enqueued, completed });
    return;
  }

  const start = performance.now();

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const headers: Record<string, string> = { "User-Agent": CHROME_UA };
    if (referer) headers["Referer"] = referer;

    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) {
      self.postMessage({ type: "error", message: `Image HTTP ${res.status} for ${url}` });
      return;
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) {
      self.postMessage({ type: "error", message: `Image content-type "${ct}" for ${url}` });
      return;
    }

    const buf = Buffer.from(await res.arrayBuffer());

    let imgW = 0;
    let imgH = 0;
    if (buf.length > 0) {
      try {
        const dims = sizeOf(buf);
        if ((dims.width && dims.width < 128) || (dims.height && dims.height < 128)) {
          return;
        }
        if (dims.width) imgW = dims.width;
        if (dims.height) imgH = dims.height;
      } catch {}
    }

    if (!localPath.match(/\.[a-z0-9]+$/i)) {
      const ext = extensionFromMime(ct);
      if (ext) localPath += ext;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(localPath, buf);
    const elapsed = Math.round(performance.now() - start);
    completed++;
    self.postMessage({ type: "progress", enqueued, completed });
    self.postMessage({ type: "timing", url, ms: elapsed });
    self.postMessage({
      type: "image-saved",
      url,
      localPath: localPath.replace(outputDir + "/", ""),
      width: imgW,
      height: imgH,
      format: ct,
    });
  } catch (e) {
    self.postMessage({ type: "error", message: `Image download error: ${e} for ${url}` });
  } finally {
    clearTimeout(t);
  }
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
      referer = data.referer || "";
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
