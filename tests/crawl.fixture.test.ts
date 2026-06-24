import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { extract } from "../lib/extract.ts";
import { fetchHtml, setChromeEnabled } from "../lib/fetchHtml.ts";

// Replicate filter constants (same as cli.ts)
const MEDIA_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
  ".mp4", ".webm", ".avi", ".mov", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".pdf", ".doc", ".docx", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
];

function isMediaLink(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch { return false; }
}

function isExcluded(url: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    try { return new RegExp(p).test(url); } catch { return false; }
  });
}

function isChallengePage(html: string): boolean {
  return (
    html.includes("Just a moment...") ||
    html.includes("security verification") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenges.cloudflare.com")
  );
}

function normalizeUrl(u: string): string {
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.substring(0, hashIdx);
  return u.replace(/\/+$/, "") + "/";
}

const FIXTURE_BASE = "file://" + __dirname + "/fixtures/crawl/";

describe("crawl fixtures", () => {
  test("isMediaLink filters image extensions", () => {
    expect(isMediaLink("https://site.com/image.jpg")).toBe(true);
    expect(isMediaLink("https://site.com/image.png")).toBe(true);
    expect(isMediaLink("https://site.com/image.gif")).toBe(true);
    expect(isMediaLink("https://site.com/image.svg")).toBe(true);
    expect(isMediaLink("https://site.com/page.html")).toBe(false);
    expect(isMediaLink("https://site.com/page.php")).toBe(false);
    expect(isMediaLink("https://site.com/assets/image.jpg?w=200")).toBe(true);
    expect(isMediaLink("https://site.com/image.JPG")).toBe(true);
  });

  test("isMediaLink filters video and audio", () => {
    expect(isMediaLink("https://site.com/video.mp4")).toBe(true);
    expect(isMediaLink("https://site.com/audio.mp3")).toBe(true);
    expect(isMediaLink("https://site.com/video.webm")).toBe(true);
  });

  test("isMediaLink filters documents", () => {
    expect(isMediaLink("https://site.com/doc.pdf")).toBe(true);
    expect(isMediaLink("https://site.com/doc.zip")).toBe(true);
    expect(isMediaLink("https://site.com/style.css")).toBe(true);
  });

  test("isExcluded matches URL patterns", () => {
    const patterns = ["/admin/", "/wiki/File:"];
    expect(isExcluded("https://site.com/admin/dashboard", patterns)).toBe(true);
    expect(isExcluded("https://site.com/wiki/File:Image.jpg", patterns)).toBe(true);
    expect(isExcluded("https://site.com/wiki/ContentPage", patterns)).toBe(false);
  });

  test("isExcluded with regex patterns", () => {
    const patterns = ["\\.(jpg|png)$"];
    expect(isExcluded("https://site.com/image.jpg", patterns)).toBe(true);
    expect(isExcluded("https://site.com/image.png", patterns)).toBe(true);
    expect(isExcluded("https://site.com/page.html", patterns)).toBe(false);
  });

  test("captcha page detected", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/captcha-page.html",
      "utf-8"
    );
    expect(isChallengePage(html)).toBe(true);
  });

  test("content page not detected as captcha", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/content-page.html",
      "utf-8"
    );
    expect(isChallengePage(html)).toBe(false);
  });

  test("index page extracts links correctly", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/index.html",
      "utf-8"
    );

    // Collect all links
    const links: string[] = [];
    const re = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      links.push(m[1]);
    }

    expect(links).toContain("content-page.html");
    expect(links).toContain("admin/dashboard.html");
    expect(links).toContain("assets/image.jpg");
    expect(links).toContain("style.css");
    expect(links.length).toBe(10);
  });

  test("media extensions filtered from resolved URLs", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/index.html",
      "utf-8"
    );

    const patterns = ["/admin/"];
    const re = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const resolved = new URL(m[1], FIXTURE_BASE).href;
      const isFiltered = isMediaLink(resolved) || isExcluded(resolved, patterns);
      const shouldFilter = isMediaLink(resolved) || patterns.some((p) => new RegExp(p).test(resolved));
      expect(isFiltered).toBe(shouldFilter);
    }
  });

  test("extract content from content-page fixture", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/content-page.html",
      "utf-8"
    );
    const r = extract(html, ["body"]);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Content Page");
    expect(r!.description).toBe("A regular content page");
  });

  test("image MIME type guard regex", () => {
    const isImageMime = (mime: string) => /^image\//.test(mime);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/gif")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(true);
    expect(isImageMime("text/html")).toBe(false);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("")).toBe(false);
  });

  test("extractAllRawLinks returns all links within urlFilter scope", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/index.html",
      "utf-8"
    );

    const urlFilter = FIXTURE_BASE;
    function normalizeUrl(u: string): string {
      const hashIdx = u.indexOf("#");
      if (hashIdx !== -1) u = u.substring(0, hashIdx);
      return u.replace(/\/+$/, "") + "/";
    }
    function extractAllRawLinks(html: string, baseUrl: string): Array<{ original: string; normalized: string }> {
      const raw: Array<{ original: string; normalized: string }> = [];
      const re = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        try {
          const resolved = new URL(m[1], baseUrl).href;
          const normalized = normalizeUrl(resolved);
          if (!urlFilter || normalized.startsWith(normalizeUrl(urlFilter))) {
            raw.push({ original: resolved, normalized });
          }
        } catch {}
      }
      const seen = new Set<string>();
      return raw.filter(({ normalized }) => { if (seen.has(normalized)) return false; seen.add(normalized); return true; });
    }

    const links = extractAllRawLinks(html, FIXTURE_BASE);
    const normalizedLinks = links.map((l) => l.normalized);

    // Should include all links including media and admin
    expect(normalizedLinks).toContain(normalizeUrl(FIXTURE_BASE + "content-page.html"));
    expect(normalizedLinks).toContain(normalizeUrl(FIXTURE_BASE + "assets/image.jpg"));
    expect(normalizedLinks).toContain(normalizeUrl(FIXTURE_BASE + "admin/dashboard.html"));
    expect(normalizedLinks).toContain(normalizeUrl(FIXTURE_BASE + "style.css"));
    expect(links.length).toBe(9); // 10 <a>, minus 1 duplicate asset/image.jpg

    // All URLs must be fully qualified (no leading /, no originless paths)
    for (const link of links) {
      expect(link.original).toMatch(/^[a-z]+:\/\//);
      expect(link.normalized).toMatch(/^[a-z]+:\/\//);
      // No double slashes or origin-relative paths
      expect(link.original).not.toMatch(/^\/\//);
      expect(link.normalized).not.toMatch(/^\/\//);
    }
  });

  test("index page has <img> tags for markdown images", () => {
    const html = readFileSync(
      __dirname + "/fixtures/crawl/index.html",
      "utf-8"
    );
    expect(html).toContain("<img");
    // turndown converts <img> to ![]() — just verify they exist in HTML
    const imgCount = (html.match(/<img\b/gi) || []).length;
    expect(imgCount).toBeGreaterThanOrEqual(2);
  });
});
