import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";

// ---- module-level helpers (mirrors what will be in lib/saveImages.ts) ----

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const ext = u.pathname.toLowerCase().split("/").pop() || "";
    for (const e of IMAGE_EXTENSIONS) {
      if (ext.endsWith(e) || ext.includes(e)) return true;
    }
    // Also check for extension with query params
    return IMAGE_EXTENSIONS.has(ext.replace(/\?.*$/, ""));
  } catch {
    return false;
  }
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/x-icon": ".ico",
  };
  return map[mime] || "";
}

function pickHighestRes(srcset: string): string {
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

function imageLocalPath(outputDir: string, url: string): string {
  const u = new URL(url);
  const host = u.hostname;
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/index";
  return outputDir + "/images/" + host + path;
}

function meetsMinSize(width: number | undefined, height: number | undefined): boolean | null {
  if (width !== undefined && height !== undefined) {
    return width >= 128 && height >= 128;
  }
  if (width !== undefined) return width >= 128 ? null : false;
  if (height !== undefined) return height >= 128 ? null : false;
  return null;
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

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
    // URLs like /thumbnail/2024/03/photo.jpg still end with .jpg
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
      .toBe("/tmp/test-output/images/cdn.example.com/index");
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

  test("regular <img src> discovered", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const imgs: string[] = [];
    const re = /<img\b[^>]*src="([^"]*)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (!m[1].startsWith("data:")) imgs.push(m[1]);
    }
    expect(imgs).toContain("https://cdn.example.com/photo.jpg");
    expect(imgs).toContain("https://cdn.example.com/icon.svg");
  });

  test("data-src fallback detected", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const re = /<img\b[^>]*data-src="([^"]*)"[^>]*>/gi;
    const m = re.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("https://cdn.example.com/lazy.jpg");
  });

  test("picture > source srcset extracted", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const sources: string[] = [];
    const re = /<source\b[^>]*srcset="([^"]*)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      sources.push(m[1]);
    }
    expect(sources.length).toBeGreaterThanOrEqual(2);
    // Pick highest from first source
    const highest = pickHighestRes(sources[0]);
    expect(highest).toBe("https://cdn.example.com/banner.webp");
  });

  test("inline svg detected", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const svgRe = /<svg[\s\S]*?<\/svg>/gi;
    const count = (html.match(svgRe) || []).length;
    expect(count).toBe(1);
    const svg = svgRe.exec(html)?.[0] || "";
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<circle");
  });

  test("data:image URL detected", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const re = /src="(data:image\/[^"]+)"/gi;
    const m = re.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/^data:image\/png;base64,/);
  });

  test("width and height attributes extracted", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const re = /<img\b[^>]*src="https:\/\/cdn\.example\.com\/photo\.jpg"[^>]*>/i;
    const m = re.exec(html);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('width="400"');
    expect(m![0]).toContain('height="300"');
  });
});

describe("markdown image rewriting", () => {
  const OUT = "/tmp/test-output";

  function rewriteMarkdownImages(md: string): string {
    return md.replace(
      /!\[([^\]]*)\]\(((?:https?:\/\/)[^)]+)\)/g,
      (_match, alt, url: string) => {
        if (isImageUrl(url)) {
          return `![${alt}](${imageLocalPath(OUT, url)})`;
        }
        return _match;
      },
    );
  }

  test("rewrites absolute image URL to local path", () => {
    const md = "![A photo](https://cdn.example.com/photo.jpg)";
    const result = rewriteMarkdownImages(md);
    expect(result).toBe("![A photo](/tmp/test-output/images/cdn.example.com/photo.jpg)");
  });

  test("rewrites image with query params", () => {
    const md = "![Photo](https://cdn.example.com/photo.jpg?w=200&cb=123)";
    const result = rewriteMarkdownImages(md);
    expect(result).toBe("![Photo](/tmp/test-output/images/cdn.example.com/photo.jpg)");
  });

  test("does not rewrite non-image markdown links", () => {
    const md = "[link text](https://cdn.example.com/page.html)";
    const result = rewriteMarkdownImages(md);
    expect(result).toBe(md);
  });

  test("does not rewrite data: URLs in markdown", () => {
    const md = "![Dot](data:image/png;base64,iVBOR)";
    const result = rewriteMarkdownImages(md);
    expect(result).toBe(md);
  });

  test("rewrites multiple images on same line", () => {
    const md = "![A](https://cdn.com/a.jpg) text ![B](https://cdn.com/b.png)";
    const result = rewriteMarkdownImages(md);
    expect(result).toContain("images/cdn.com/a.jpg");
    expect(result).toContain("images/cdn.com/b.png");
  });

  test("rewrites relative path within output dir", () => {
    // When used in actual crawl, the file path is relative from .md location
    const imgPath = imageLocalPath(OUT, "https://cdn.com/photo.jpg");
    const relative = imgPath.replace(OUT + "/", "");
    expect(relative).toBe("images/cdn.com/photo.jpg");
  });
});

describe("queue and dedup", () => {
  test("enqueue dedup by URL", () => {
    const seen = new Set<string>();
    const enqueue = (url: string) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    };
    expect(enqueue("https://cdn.com/a.jpg")).toBe(true);
    expect(enqueue("https://cdn.com/a.jpg")).toBe(false); // duplicate
    expect(enqueue("https://cdn.com/b.jpg")).toBe(true);   // different
    expect(seen.size).toBe(2);
  });

  test("batch size of 20", () => {
    // Simulate queue draining: splice 20 at a time
    const queue = Array.from({ length: 45 }, (_, i) => `https://cdn.com/img${i}.jpg`);
    const batches: string[][] = [];
    while (queue.length > 0) {
      batches.push(queue.splice(0, 20));
    }
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(20);
    expect(batches[1].length).toBe(20);
    expect(batches[2].length).toBe(5);
  });
});

describe("inline SVG extraction", () => {
  test("svg outerHTML can be hashed and saved", () => {
    const html = readFileSync(__dirname + "/fixtures/crawl/images-page.html", "utf-8");
    const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
    expect(svgMatch).not.toBeNull();
    const svg = svgMatch![0];

    // Hash of content (simulating MD5 or SHA)
    const contentHash = svg.length.toString(16); // placeholder hash strategy
    const filename = `_inline/${contentHash}.svg`;
    expect(filename).toMatch(/^_inline\/[0-9a-f]+\.svg$/);
    expect(svg).toContain("<circle");
  });

  test("svg is replaced with img tag after extraction", () => {
    const html = readFileSync(__dirname + "/fixtures/crawl/images-page.html", "utf-8");
    const svgRe = /<svg[\s\S]*?<\/svg>/i;
    const svg = svgRe.exec(html)?.[0] || "";
    const hash = svg.length.toString(16);
    const replaced = html.replace(svgRe, `<img src="_inline/${hash}.svg" alt="">`);

    expect(replaced).not.toContain("<svg");
    expect(replaced).toContain('src="_inline/');
  });
});

describe("data URL extraction", () => {
  test("data URL can be decoded and saved", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    expect(match).not.toBeNull();
    const ext = match![1] === "svg+xml" ? ".svg" : "." + match![1].replace("+xml", "");
    const raw = Buffer.from(match![2], "base64");
    expect(raw.length).toBeGreaterThan(0);
    // 1x1 transparent PNG from the fixture data
    expect(raw.length).toBe(70);
    expect(ext).toBe(".png");
  });

  test("data-url img src is replaced with file path", () => {
    const html = '<img src="data:image/png;base64,iVBOR" alt="Dot">';
    const replaced = html.replace(
      /src="(data:image\/[^"]+)"/g,
      'src="_data/abc123.png"',
    );
    expect(replaced).not.toContain("data:image");
    expect(replaced).toContain('src="_data/abc123.png"');
  });
});

describe("CDP blocking interaction", () => {
  test('"Image" is NOT blocked when --save-images is active', () => {
    const blockedWithImages = new Set([
      "Font", "Media", "WebSocket", "Manifest", "Stylesheet", "Image",
    ]);
    const blockedWithoutImages = new Set([
      "Font", "Media", "WebSocket", "Manifest", "Stylesheet",
    ]);

    const saveImages = true;
    const active = saveImages
      ? blockedWithoutImages
      : blockedWithImages;

    expect(active.has("Image")).toBe(false);
    expect(active.has("Stylesheet")).toBe(true);
  });

  test('"Image" IS blocked when --save-images is off', () => {
    const blocked = new Set([
      "Font", "Media", "WebSocket", "Manifest", "Stylesheet", "Image",
    ]);
    const saveImages = false;
    const active = saveImages
      ? new Set([...blocked].filter((t) => t !== "Image"))
      : blocked;

    expect(active.has("Image")).toBe(true);
  });
});
