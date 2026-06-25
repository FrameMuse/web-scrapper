import { describe, test, expect, afterAll } from "bun:test";
import { fetchHtml, getChromeSession, setSaveImages } from "../lib/fetchHtml";

function isChallengePage(html: string): boolean {
  return (
    html.includes("Just a moment...") ||
    html.includes("security verification") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenges.cloudflare.com")
  );
}

describe("isChallengePage", () => {
  test("detects 'Just a moment...'", () => {
    expect(isChallengePage("Just a moment...")).toBe(true);
  });

  test("detects 'security verification'", () => {
    expect(isChallengePage("security verification page")).toBe(true);
  });

  test("detects 'cf-browser-verification'", () => {
    expect(isChallengePage("<div>cf-browser-verification</div>")).toBe(true);
  });

  test("detects 'challenges.cloudflare.com'", () => {
    expect(isChallengePage("src='https://challenges.cloudflare.com/cdn-cgi/browser-verification'")).toBe(true);
  });

  test("returns false for normal HTML", () => {
    expect(isChallengePage("<html><body>Welcome to our wiki</body></html>")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isChallengePage("")).toBe(false);
  });
});

describe("setSaveImages", () => {
  test("is a no-op (does not throw)", () => {
    expect(() => setSaveImages(true)).not.toThrow();
    expect(() => setSaveImages(false)).not.toThrow();
  });
});

describe("getChromeSession", () => {
  test("returns null when Chrome not enabled", () => {
    expect(getChromeSession()).toBeNull();
  });
});

describe("fetchHtml", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls fetchWithHttp when Chrome not enabled and returns HTML", async () => {
    globalThis.fetch = async (url: RequestInfo | URL, opts?: RequestInit) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      expect(u).toBe("https://example.com/test-page");

      // Verify headers
      const headers = (opts?.headers || {}) as Record<string, string>;
      expect(headers["User-Agent"]).toBeDefined();
      expect(headers["User-Agent"]).toContain("Chrome");
      expect(headers["Accept"]).toBeDefined();
      expect(headers["Accept-Language"]).toBeDefined();

      return new Response("<html><body>Hello</body></html>", {
        headers: { "content-type": "text/html" },
      });
    };

    const result = await fetchHtml("https://example.com/test-page");
    expect(result.html).toBe("<html><body>Hello</body></html>");
    expect(result.contentType).toContain("text/html");
  });

  test("throws on non-200 HTTP response", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });

    let caught = false;
    try {
      await fetchHtml("https://example.com/missing");
    } catch (e: any) {
      expect(e.message).toContain("404");
      caught = true;
    }
    expect(caught).toBe(true);
  });

  test("throws on network error", async () => {
    globalThis.fetch = async () => { throw new Error("ENOTFOUND"); };

    let caught = false;
    try {
      await fetchHtml("https://example.com/unknown");
    } catch (e: any) {
      expect(e.message).toBeDefined();
      caught = true;
    }
    expect(caught).toBe(true);
  });

  test("returns contentType from response headers", async () => {
    globalThis.fetch = async () => new Response("<html></html>", {
      headers: { "content-type": "application/xhtml+xml" },
    });

    const result = await fetchHtml("https://example.com/xhtml");
    expect(result.contentType).toBe("application/xhtml+xml");
  });
});
