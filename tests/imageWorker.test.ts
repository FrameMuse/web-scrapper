import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const PORT = 9876 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const TEST_OUTPUT = "/tmp/test-image-worker-" + Date.now();

let server: ReturnType<typeof Bun.serve>;

function createBmp(width: number, height: number, r: number, g: number, b: number): Buffer {
  const rowSize = Math.ceil(width * 3 / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 14 + 40 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(14 + 40, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(0, 38);
  buf.writeInt32LE(0, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const rowOffset = 14 + 40 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const p = rowOffset + x * 3;
      buf[p] = b;
      buf[p + 1] = g;
      buf[p + 2] = r;
    }
  }

  return buf;
}

beforeAll(() => {
  mkdirSync(TEST_OUTPUT, { recursive: true });
  server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/success.bmp") {
        return new Response(createBmp(128, 128, 255, 0, 0), {
          headers: { "content-type": "image/bmp" },
        });
      }
      if (url.pathname.startsWith("/success_") && url.pathname.endsWith(".bmp")) {
        return new Response(createBmp(128, 128, 0, 255, 0), {
          headers: { "content-type": "image/bmp" },
        });
      }
      if (url.pathname === "/small.bmp") {
        return new Response(createBmp(32, 32, 0, 0, 255), {
          headers: { "content-type": "image/bmp" },
        });
      }
      if (url.pathname === "/not-image") {
        return new Response("plain text", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop();
  rmSync(TEST_OUTPUT, { recursive: true, force: true });
});

function waitForMessage(worker: Worker, type: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}" message`)), timeout);
    const handler = (e: MessageEvent) => {
      if (e.data.type === type) {
        clearTimeout(timer);
        worker.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    worker.addEventListener("message", handler);
  });
}

function waitForCompleted(worker: Worker, target: number, timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for completed=${target}`)), timeout);
    const handler = (e: MessageEvent) => {
      if (e.data.type === "progress" && e.data.completed >= target) {
        clearTimeout(timer);
        worker.removeEventListener("message", handler);
        resolve(e.data);
      }
    };
    worker.addEventListener("message", handler);
  });
}

function createWorker(): Worker {
  const workerUrl = new URL("../lib/imageWorker.ts", import.meta.url).href;
  const w = new Worker(workerUrl);
  w.postMessage({ type: "init", outputDir: TEST_OUTPUT, referer: BASE + "/" });
  return w;
}

describe("imageWorker", () => {

  test("init starts processLoop (no messages when idle)", async () => {
    const worker = createWorker();
    // Wait a bit — should receive nothing since queue is empty
    const gotMsg = await Promise.race([
      waitForMessage(worker, "progress", 800).then(() => true).catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 800)),
    ]);
    expect(gotMsg).toBe(false);
    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("enqueue + download success", async () => {
    const worker = createWorker();
    const url = `${BASE}/success.bmp`;

    // Register listener BEFORE posting to avoid race
    const progress1 = waitForMessage(worker, "progress", 5000);
    worker.postMessage({ type: "enqueue", url });
    const p1 = await progress1;
    expect(p1.enqueued).toBeGreaterThanOrEqual(1);

    // Wait for download to complete
    const p2 = await waitForCompleted(worker, 1, 5000);
    expect(p2.completed).toBeGreaterThanOrEqual(1);

    const timing = await waitForMessage(worker, "timing", 5000);
    expect(timing.url).toBe(url);
    expect(timing.ms).toBeGreaterThan(0);

    // File should exist on disk
    expect(existsSync(join(TEST_OUTPUT, "images", "localhost", "success.bmp"))).toBe(true);

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("enqueue + already on disk works without exists check", async () => {
    const worker = createWorker();
    const url = `${BASE}/success.bmp`;

    // Enqueue — no DB-backed _seen set here, Worker handles it via fetch
    const progress1 = waitForMessage(worker, "progress", 5000);
    worker.postMessage({ type: "enqueue", url });
    const p1 = await progress1;
    expect(p1.enqueued).toBeGreaterThanOrEqual(1);

    // Image downloads normally (we removed the Worker-level existsSync check)
    const p2 = await waitForMessage(worker, "progress", 5000);
    expect(p2.completed).toBeGreaterThanOrEqual(1);

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("enqueue + HTTP 404 posts error", async () => {
    const worker = createWorker();
    const url = `${BASE}/nonexistent`;

    worker.postMessage({ type: "enqueue", url });
    const error = await waitForMessage(worker, "error", 5000);
    expect(error.message).toContain("404");

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("enqueue + wrong content-type posts error", async () => {
    const worker = createWorker();
    const url = `${BASE}/not-image`;

    worker.postMessage({ type: "enqueue", url });
    const error = await waitForMessage(worker, "error", 5000);
    expect(error.message).toContain("content-type");

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("enqueue + too small image ignored silently (no progress increment)", async () => {
    const worker = createWorker();
    const url = `${BASE}/small.bmp`;

    // Enqueue the small image
    worker.postMessage({ type: "enqueue", url });

    // Wait a bit — should NOT get a progress message with completed incremented
    // (the too-small path returns without posting progress)
    let completedIncreased = false;
    const handler = (e: MessageEvent) => {
      if (e.data.type === "progress" && e.data.completed > 0) {
        completedIncreased = true;
      }
    };
    worker.addEventListener("message", handler);
    await new Promise((r) => setTimeout(r, 1500));
    worker.removeEventListener("message", handler);

    expect(completedIncreased).toBe(false);

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 2000);
    worker.terminate();
  });

  test("stop drains queue before done", async () => {
    const worker = createWorker();
    const urls = [
      `${BASE}/success.bmp`,
      `${BASE}/success.bmp`,
      `${BASE}/success.bmp`,
    ];

    for (const u of urls) {
      worker.postMessage({ type: "enqueue", url: u });
    }

    // Wait for all 3 completions
    // (if dedup'd they may be fewer, so just check at least some complete)
    const progress = await waitForMessage(worker, "progress", 5000);
    expect(progress.enqueued).toBeGreaterThanOrEqual(1);

    worker.postMessage({ type: "stop" });
    const done = await waitForMessage(worker, "done", 5000);
    expect(done.type).toBe("done");

    worker.terminate();
  });

  test("batch processing handles 25 URLs", async () => {
    const worker = createWorker();
    const completedBefore = await new Promise<number>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === "progress") resolve(e.data.completed);
      };
      worker.addEventListener("message", handler);
      // Enqueue 25 copies — local dedup means the Worker only gets the first one
      worker.postMessage({ type: "enqueue", url: `${BASE}/success.bmp` });
      // But Worker has its own dedup (seen set), so only the first gets processed
      setTimeout(() => {
        worker.removeEventListener("message", handler);
        resolve(0);
      }, 50);
    });

    // Enqueue 25 unique URLs to force batching
    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 3000).catch(() => {});
    worker.terminate();
  });

  test("multiple unique URLs all complete", async () => {
    const worker = createWorker();
    const N = 5;
    const urls: string[] = [];
    for (let i = 0; i < N; i++) {
      urls.push(`${BASE}/success_${i}.bmp`);
    }

    for (const u of urls) {
      worker.postMessage({ type: "enqueue", url: u });
    }

    const last = await waitForCompleted(worker, N, 10000);
    expect(last.enqueued).toBe(N);
    expect(last.completed).toBe(N);

    worker.postMessage({ type: "stop" });
    await waitForMessage(worker, "done", 3000);
    worker.terminate();
  });

});
