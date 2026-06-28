import {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
  isImageUrl,
  pickHighestRes,
  meetsMinSize,
} from "./image-common.ts";
import type { LinkDb } from "./linkDb.ts";
import { log } from "./runLogger.ts";
export {
  IMAGE_EXTENSIONS,
  extensionFromMime,
  imageLocalPath,
  isImageUrl,
  pickHighestRes,
  meetsMinSize,
} from "./image-common.ts";

let _worker: Worker | null = null;
let _nextId = 0;

function getWorker(): Worker {
  if (!_worker) {
    const url = new URL("./preprocessWorker.ts", import.meta.url).href;
    _worker = new Worker(url);
  }
  return _worker;
}

export async function preprocessImages(
  html: string,
  pageUrl: string,
  outputDir: string,
  enqueue: (url: string, width?: number, height?: number, alt?: string) => void,
): Promise<string> {
  const worker = getWorker();
  const id = _nextId++;
  return new Promise<string>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (data.id !== id) return;
      worker.removeEventListener("message", handler);
      if (data.type === "result") {
        for (const img of data.images) {
          enqueue(img.url, img.width, img.height, img.alt);
        }
        resolve(data.html);
      } else if (data.type === "error") {
        reject(new Error(data.message));
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "process", id, html, pageUrl, outputDir });
  });
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
      const rel = local.replace(outputDir + "/", "");
      return `![${alt}](${rel})`;
    },
  );
}

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
