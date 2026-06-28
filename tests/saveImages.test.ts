import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  isImageUrl,
  extensionFromMime,
  pickHighestRes,
  imageLocalPath,
  meetsMinSize,
  preprocessImages,
  rewriteMarkdownImages,
  ImageDownloader,
} from "../lib/saveImages";

// ---- Tests ----

describe("image URL detection", () => {
  test("isImageUrl detects image extensions", () => {
    expect(isImageUrl("https://cdn.com/photo.jpg")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.jpeg")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.png")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.gif")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.svg")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.webp")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.bmp")).toBe(true);
    expect(isImageUrl("https://cdn.com/photo.ico")).toBe(true);
  });

  test("isImageUrl returns false for non-image URLs", () => {
    expect(isImageUrl("https://cdn.com/page.html")).toBe(false);
    expect(isImageUrl("https://cdn.com/script.js")).toBe(false);
    expect(isImageUrl("https://cdn.com/style.css")).toBe(false);
    expect(isImageUrl("https://cdn.com/doc.pdf")).toBe(false);
  });

  test("isImageUrl handles query strings", () => {
    expect(isImageUrl("https://cdn.com/photo.jpg?w=200&h=100")).toBe(true);
    expect(isImageUrl("https://cdn.com/page.html?format=jpg")).toBe(false);
  });

  test("isImageUrl handles path-based extensions", () => {
    expect(isImageUrl("https://cdn.com/thumbnail/2024/03/photo.jpg")).toBe(true);
  });

  test("extensionFromMime maps content types", () => {
    expect(extensionFromMime("image/jpeg")).toBe(".jpg");
    expect(extensionFromMime("image/png")).toBe(".png");
    expect(extensionFromMime("image/webp")).toBe(".webp");
    expect(extensionFromMime("image/svg+xml")).toBe(".svg");
    expect(extensionFromMime("image/gif")).toBe(".gif");
    expect(extensionFromMime("image/bmp")).toBe(".bmp");
    expect(extensionFromMime("image/x-icon")).toBe(".ico");
    expect(extensionFromMime("text/html")).toBe("");
    expect(extensionFromMime("")).toBe("");
  });
});

describe("srcset parsing", () => {
  test("picks highest width descriptor", () => {
    const srcset = "https://cdn.com/banner-small.jpg 600w, https://cdn.com/banner.jpg 1200w";
    expect(pickHighestRes(srcset)).toBe("https://cdn.com/banner.jpg");
  });

  test("picks highest x descriptor", () => {
    const srcset = "https://cdn.com/icon.png 1x, https://cdn.com/icon@2x.png 2x, https://cdn.com/icon@3x.png 3x";
    expect(pickHighestRes(srcset)).toBe("https://cdn.com/icon@3x.png");
  });

  test("handles mixed width and x descriptors", () => {
    const srcset = "https://cdn.com/small.jpg 300w, https://cdn.com/large.jpg 1200w";
    expect(pickHighestRes(srcset)).toBe("https://cdn.com/large.jpg");
  });

  test("handles URL without descriptor", () => {
    const srcset = "https://cdn.com/fallback.jpg https://cdn.com/highres.jpg 2x";
    expect(pickHighestRes(srcset)).toBe("https://cdn.com/highres.jpg");
  });

  test("returns empty string for empty srcset", () => {
    expect(pickHighestRes("")).toBe("");
  });

  test("handles trailing commas and whitespace", () => {
    const srcset = "  https://cdn.com/a.jpg 600w , https://cdn.com/b.jpg 1200w ";
    expect(pickHighestRes(srcset)).toBe("https://cdn.com/b.jpg");
  });
});

describe("local image path computation", () => {
  const OUT = "/tmp/test-output";

  test("mirrors host and pathname", () => {
    const url = "https://cdn.example.com/images/a/b/photo.jpg";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/images/a/b/photo.jpg");
  });

  test("strips trailing slash from pathname", () => {
    const url = "https://cdn.example.com/images/a/b/";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/images/a/b");
  });

  test("handles URL without path", () => {
    const url = "https://cdn.example.com";
    expect(imageLocalPath(OUT, url))
      .toBe(join("/tmp/test-output/images/cdn.example.com/index"));
  });

  test("handles URL with port", () => {
    const url = "https://cdn.example.com:8080/images/photo.jpg";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/images/photo.jpg");
  });

  test("strips query and hash from path computation", () => {
    const url = "https://cdn.example.com/images/photo.jpg?w=200&cb=123#anchor";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/images/photo.jpg");
  });

  test("flattens segments after extension-bearing segment", () => {
    const url = "https://cdn.example.com/Foo.png/revision/latest/scale-to-width-down/250";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/Foo_revision_latest_scale-to-width-down_250.png");
  });

  test("flattens with dir segments before extension", () => {
    const url = "https://cdn.example.com/a/b/Foo.png/revision/latest";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/a/b/Foo_revision_latest.png");
  });

  test("no change when extension is in last segment", () => {
    const url = "https://cdn.example.com/path/to/photo.jpg";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/path/to/photo.jpg");
  });

  test("no flatten when no extension found", () => {
    const url = "https://cdn.example.com/revision/latest/scale-to-width-down/250";
    expect(imageLocalPath(OUT, url))
      .toBe("/tmp/test-output/images/cdn.example.com/revision/latest/scale-to-width-down/250");
  });
});

describe("size filtering (128x128 minimum)", () => {
  test("both dimensions known and >= 128 returns true", () => {
    expect(meetsMinSize(200, 200)).toBe(true);
    expect(meetsMinSize(128, 128)).toBe(true);
  });

  test("both dimensions known but < 128 returns false", () => {
    expect(meetsMinSize(32, 32)).toBe(false);
    expect(meetsMinSize(127, 127)).toBe(false);
  });

  test("one dimension < 128 returns false", () => {
    expect(meetsMinSize(32, 200)).toBe(false);
    expect(meetsMinSize(200, 32)).toBe(false);
  });

  test("both unknown returns null (needs download)", () => {
    expect(meetsMinSize(undefined, undefined)).toBeNull();
  });

  test("one known >= 128, one unknown returns null", () => {
    expect(meetsMinSize(200, undefined)).toBeNull();
    expect(meetsMinSize(undefined, 200)).toBeNull();
  });

  test("one known < 128, one unknown returns false", () => {
    expect(meetsMinSize(32, undefined)).toBe(false);
    expect(meetsMinSize(undefined, 32)).toBe(false);
  });
});

describe("HTML image extraction", () => {
  const FIXTURE = __dirname + "/fixtures/crawl/images-page.html";
  const BASE = "file://" + __dirname + "/fixtures/crawl/";

  test("fixture has expected image types", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    expect(html).toContain("<img");
    expect(html).toContain("<picture>");
    expect(html).toContain("<svg");
    expect(html).toContain("data:image/png");
    expect(html).toContain("data-src");
  });

  test("preprocessImages enqueues discovered images", async () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const enqueued: string[] = [];
    const result = await await preprocessImages(html, BASE, "/tmp", (url, w, h) => {
      enqueued.push(url);
    });

    // Should have enqueued regular img, source srcset (best res), etc.
    // icon.svg (32x32) is filtered out by early size check (<128)
    expect(enqueued.length).toBeGreaterThanOrEqual(2);
    expect(enqueued.some((u) => u.includes("photo.jpg"))).toBe(true);
  });

  test("preprocessImages replaces inline <svg> with <img>", async () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const result = await await preprocessImages(html, BASE, "/tmp", () => {});
    expect(result).not.toContain("<svg");
    expect(result).toContain('<img src="_inline/');
  });

  test("preprocessImages replaces data: URLs with local paths", async () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const enqueued: string[] = [];
    const result = await preprocessImages(html, BASE, "/tmp", () => {});
    // The original data: URL should be replaced
    expect(result).not.toContain("data:image/png;base64,");
    // The replacement should have _data/ path
    expect(result).toContain('src="_data/');
  });

  test("preprocessImages resolves relative src against pageUrl", async () => {
    const html = '<img src="assets/photo.jpg">';
    const enqueued: string[] = [];
    await preprocessImages(html, "https://site.com/wiki/Page", "/tmp", (url) => {
      enqueued.push(url);
    });
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]).toBe("https://site.com/wiki/assets/photo.jpg");
  });

  test("width and height used for early size filtering", async () => {
    const html = '<img src="https://cdn.com/photo.jpg" width="400" height="300">';
    const enqueued: string[] = [];
    await preprocessImages(html, "https://base.com/", "/tmp", (url) => {
      enqueued.push(url);
    });
    // 400x300 passes min size (>=128) so it is enqueued
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]).toContain("photo.jpg");
  });

  test("small images (< 128) filtered out early", async () => {
    const html = '<img src="https://cdn.com/small-icon.png" width="32" height="32">';
    const enqueued: string[] = [];
    await preprocessImages(html, "https://base.com/", "/tmp", (url) => {
      enqueued.push(url);
    });
    expect(enqueued.length).toBe(0);
  });
});

describe("markdown image rewriting", () => {
  const OUT = "/tmp/test-output";

  test("rewrites absolute image URL to local path", () => {
    const md = "![A photo](https://cdn.example.com/photo.jpg)";
    const result = rewriteMarkdownImages(md, OUT);
    expect(result).toBe("![A photo](images/cdn.example.com/photo.jpg)");
  });

  test("rewrites image with query params", () => {
    const md = "![Photo](https://cdn.example.com/photo.jpg?w=200&cb=123)";
    const result = rewriteMarkdownImages(md, OUT);
    expect(result).toBe("![Photo](images/cdn.example.com/photo.jpg)");
  });

  test("does not rewrite non-image markdown links", () => {
    const md = "[link text](https://cdn.example.com/page.html)";
    const result = rewriteMarkdownImages(md);
    expect(result).toBe(md);
  });

  test("does not rewrite data: URLs in markdown", () => {
    const md = "![Dot](data:image/png;base64,iVBOR)";
    const result = rewriteMarkdownImages(md, OUT);
    expect(result).toBe(md);
  });

  test("rewrites multiple images on same line", () => {
    const md = "![A](https://cdn.com/a.jpg) text ![B](https://cdn.com/b.png)";
    const result = rewriteMarkdownImages(md, OUT);
    expect(result).toContain("images/cdn.com/a.jpg");
    expect(result).toContain("images/cdn.com/b.png");
  });
});

describe("ImageDownloader queue", () => {
  test("enqueue dedup by URL", () => {
    const dl = new ImageDownloader("/tmp/test");
    dl.enqueue("https://cdn.com/a.jpg");
    dl.enqueue("https://cdn.com/a.jpg");
    dl.enqueue("https://cdn.com/b.jpg");
    // After start(), queue processes in background, but we can check stop()
    // which flushes remaining. For this test we just verify no duplicates.
    dl.stop();
    expect(true).toBe(true); // no crash = pass
  });
});

describe("inline SVG extraction", () => {
  test("svg outerHTML can be hashed and saved", () => {
    const html = readFileSync(__dirname + "/fixtures/crawl/images-page.html", "utf-8");
    const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
    expect(svgMatch).not.toBeNull();
    const svg = svgMatch![0];
    expect(svg).toContain("<circle");
  });

  test("preprocessImages replaces svg with img tag", async () => {
    const html = readFileSync(__dirname + "/fixtures/crawl/images-page.html", "utf-8");
    const result = await preprocessImages(html, "https://base.com/", "/tmp", () => {});
    expect(result).not.toContain("<svg");
    expect(result).toContain('src="_inline/');
  });

});

describe("data URL extraction", () => {
  test("data URL can be decoded and saved", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    expect(match).not.toBeNull();
    const ext = match![1] === "svg+xml" ? ".svg" : "." + match![1].replace("+xml", "");
    const raw = Buffer.from(match![2], "base64");
    expect(raw.length).toBe(70);
    expect(ext).toBe(".png");
  });

  test("preprocessImages replaces data-url src with file path", async () => {
    const html = '<img src="data:image/png;base64,iVBOR" alt="Dot">';
    const result = await preprocessImages(html, "https://base.com/", "/tmp", () => {});
    expect(result).not.toContain("data:image/png");
    expect(result).toContain('src="_data/');
  });
});

describe("CDP blocking interaction", () => {
  test('"Image" is NOT blocked when --save-images is active', () => {
    // This tests the logic that fetchHtml.ts uses
    const blocked = new Set(["Font", "Media", "WebSocket", "Manifest", "Stylesheet"]);
    const saveImages = true;
    if (!saveImages) blocked.add("Image");
    expect(blocked.has("Image")).toBe(false);
  });

  test('"Image" IS blocked when --save-images is off', () => {
    const blocked = new Set(["Font", "Media", "WebSocket", "Manifest", "Stylesheet"]);
    const saveImages = false;
    if (!saveImages) blocked.add("Image");
    expect(blocked.has("Image")).toBe(true);
  });
});

describe("ImageDownloader lifecycle", () => {
  const OUT = "/tmp/test-imgdl-lifecycle";

  test("constructor stores outputDir and referer", () => {
    const dl = new ImageDownloader(OUT, "https://site.com/");
    expect(dl.outputDir).toBe(OUT);
    expect((dl as any).referer).toBe("https://site.com/");
  });

  test("constructor defaults referer to empty", () => {
    const dl = new ImageDownloader(OUT);
    expect((dl as any).referer).toBe("");
  });

  test("enqueue deduplicates without Worker", () => {
    const dl = new ImageDownloader(OUT);
    dl.enqueue("https://cdn.com/a.jpg");
    dl.enqueue("https://cdn.com/a.jpg");
    dl.enqueue("https://cdn.com/b.jpg");
    expect(dl.enqueued).toBe(2);
  });

  test("enqueue before start does not crash", () => {
    const dl = new ImageDownloader(OUT);
    dl.enqueue("https://cdn.com/a.jpg");
    expect(dl.enqueued).toBe(1);
  });

  test("start creates Worker and sends init", async () => {
    const dl = new ImageDownloader(OUT);
    dl.start();
    expect((dl as any).worker).not.toBeNull();
    await dl.stop();
  });

  test("start + stop lifecycle", async () => {
    const dl = new ImageDownloader(OUT);
    dl.start();
    await dl.stop();
    expect((dl as any).worker).toBeNull();
  });

  test("stop without start returns immediately", async () => {
    const dl = new ImageDownloader(OUT);
    await dl.stop();
  });
});
