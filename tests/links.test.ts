import { describe, test, expect, mock } from "bun:test";
import {
  hasMediaExtension,
  normalizeUrl,
  extractAllRawLinks,
} from "../lib/links.ts";
import { addToMap } from "../lib/linkMap.ts";

describe("links module", () => {
  test("hasMediaExtension filters image extensions", () => {
    expect(hasMediaExtension("https://site.com/image.jpg")).toBe(true);
    expect(hasMediaExtension("https://site.com/image.png")).toBe(true);
    expect(hasMediaExtension("https://site.com/image.gif")).toBe(true);
    expect(hasMediaExtension("https://site.com/image.svg")).toBe(true);
    expect(hasMediaExtension("https://site.com/page.html")).toBe(false);
    expect(hasMediaExtension("https://site.com/page.php")).toBe(false);
    expect(hasMediaExtension("https://site.com/assets/image.jpg?w=200")).toBe(true);
    expect(hasMediaExtension("https://site.com/image.JPG")).toBe(true);
    expect(hasMediaExtension("https://site.com/image.JPEG")).toBe(true);
    expect(hasMediaExtension("https://site.com/video.mp4")).toBe(true);
    expect(hasMediaExtension("https://site.com/audio.mp3")).toBe(true);
    expect(hasMediaExtension("https://site.com/doc.pdf")).toBe(true);
    expect(hasMediaExtension("https://site.com/style.css")).toBe(true);
    expect(hasMediaExtension("https://site.com/video.webm")).toBe(true);
    expect(hasMediaExtension("https://site.com/doc.zip")).toBe(true);
    expect(hasMediaExtension("https://site.com/file")).toBe(false);
    expect(hasMediaExtension("https://site.com/")).toBe(false);
    expect(hasMediaExtension("https://site.com/file.")).toBe(false);
  });

  test("hasMediaExtension throws on invalid URL", () => {
    expect(() => hasMediaExtension("not a url")).toThrow();
  });

  test("normalizeUrl strips hash and trailing slashes", () => {
    expect(normalizeUrl("https://site.com/page#anchor")).toBe("https://site.com/page");
    expect(normalizeUrl("https://site.com/page/")).toBe("https://site.com/page");
    expect(normalizeUrl("https://site.com/page")).toBe("https://site.com/page");
    expect(normalizeUrl("https://site.com/page//")).toBe("https://site.com/page");
    expect(normalizeUrl("https://site.com/page?q=1")).toBe("https://site.com/page?q=1");
    expect(normalizeUrl("https://site.com/page/?q=1")).toBe("https://site.com/page/?q=1");
  });

  test("normalizeUrl preserves URL without hash or trailing slash", () => {
    expect(normalizeUrl("https://site.com/page")).toBe("https://site.com/page");
    expect(normalizeUrl("https://site.com/page?q=1")).toBe("https://site.com/page?q=1");
  });

  test("normalizeUrl does not add trailing slash to Fuel_Cache-like URLs", () => {
    expect(normalizeUrl("https://companyofheroes.fandom.com/wiki/Fuel_Cache")).toBe(
      "https://companyofheroes.fandom.com/wiki/Fuel_Cache"
    );
    expect(normalizeUrl("https://companyofheroes.fandom.com/wiki/Fuel_Cache/")).toBe(
      "https://companyofheroes.fandom.com/wiki/Fuel_Cache"
    );
  });

  describe("extractAllRawLinks", () => {
    test("extracts href from simple <a> tag", () => {
      const links = extractAllRawLinks(
        '<a href="/page">link</a>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("https://site.com/page");
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("resolves relative href against baseUrl", () => {
      const links = extractAllRawLinks(
        '<a href="page">link</a>',
        "https://site.com/wiki/",
      );
      expect(links[0].original).toBe("https://site.com/wiki/page");
    });

    test("resolves absolute path against baseUrl origin", () => {
      const links = extractAllRawLinks(
        '<a href="/absolute/path">link</a>',
        "https://site.com/wiki/",
      );
      expect(links[0].original).toBe("https://site.com/absolute/path");
    });

    test("keeps absolute URL unchanged", () => {
      const links = extractAllRawLinks(
        '<a href="https://other.com/page">link</a>',
        "https://site.com/",
      );
      expect(links[0].original).toBe("https://other.com/page");
    });

    test("returns empty array when no <a> tags", () => {
      const links = extractAllRawLinks(
        "<p>no links here</p>",
        "https://site.com/",
      );
      expect(links).toHaveLength(0);
    });

    test("urlFilter includes only links starting with filter", () => {
      const html = '<a href="/docs/a">A</a><a href="/blog/b">B</a><a href="/docs/c">C</a>';
      const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/docs/");
      expect(links).toHaveLength(2);
      expect(links[0].original).toBe("https://site.com/docs/a");
      expect(links[1].original).toBe("https://site.com/docs/c");
    });

    test("urlFilter excludes links outside filter", () => {
      const html = '<a href="/other/page">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/docs/");
      expect(links).toHaveLength(0);
    });

    test("urlFilter with undefined filter includes all links", () => {
      const html = '<a href="/a">A</a><a href="/b">B</a>';
      const links = extractAllRawLinks(html, "https://site.com/", undefined);
      expect(links).toHaveLength(2);
    });

    test("urlFilter normalization: trailing slash on filter matches both /page and /page/", () => {
      const html = '<a href="/docs/page">P</a><a href="/docs/page/">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/docs/");
      expect(links).toHaveLength(1);
    });

    test("skipQuery=true strips query from normalized, keeps in original", () => {
      const html = '<a href="/page?ref=nav">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", undefined, true);
      expect(links[0].original).toBe("https://site.com/page?ref=nav");
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("skipQuery=false keeps query in both original and normalized", () => {
      const html = '<a href="/page?ref=nav">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", undefined, false);
      expect(links[0].original).toBe("https://site.com/page?ref=nav");
      expect(links[0].normalized).toBe("https://site.com/page?ref=nav");
    });

    test("skipQuery strips query from normalized (regardless of filter match)", () => {
      const html = '<a href="/docs/page?q=1">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/docs/", true);
      expect(links[0].original).toBe("https://site.com/docs/page?q=1");
      expect(links[0].normalized).toBe("https://site.com/docs/page");
    });

    test("deduplicates by normalized URL: identical URLs", () => {
      const html = '<a href="/page">P</a><a href="/page">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(1);
    });

    test("deduplicates by normalized URL: /page and /page/ collapse to same", () => {
      const html = '<a href="/page">P</a><a href="/page/">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(1);
    });

    test("deduplicates by normalized URL: /page and /page#hash collapse to same", () => {
      const html = '<a href="/page">P</a><a href="/page#hash">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(1);
    });

    test("deduplicates by normalized URL: /page?q=1 and /page?q=2 collapse when skipQuery=true", () => {
      const html = '<a href="/page?q=1">P</a><a href="/page?q=2">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/", undefined, true);
      expect(links).toHaveLength(1);
    });

    test("deduplicates by normalized URL: different queries are distinct when skipQuery=false", () => {
      const html = '<a href="/page?q=1">P</a><a href="/page?q=2">P</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(2);
    });

    test("handles double-quoted href", () => {
      const links = extractAllRawLinks(
        '<a href="/page">link</a>',
        "https://site.com/",
      );
      expect(links[0].original).toBe("https://site.com/page");
    });

    test("handles single-quoted href", () => {
      const links = extractAllRawLinks(
        "<a href='/page'>link</a>",
        "https://site.com/",
      );
      expect(links[0].original).toBe("https://site.com/page");
    });

    test("handles mixed quote styles across multiple links", () => {
      const html = '<a href="/a">A</a><a href=\'/b\'>B</a><a href="/c">C</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(3);
    });

    test("skips empty href", () => {
      const html = '<a href="">link</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(0);
    });

    test("skips <a> tags without href attribute", () => {
      const html = '<a>no href</a><a name="anchor">anchor</a>';
      const links = extractAllRawLinks(html, "https://site.com/");
      expect(links).toHaveLength(0);
    });

    test("handles attributes before href", () => {
      const links = extractAllRawLinks(
        '<a class="nav" id="link1" href="/page">link</a>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("https://site.com/page");
    });

    test("handles attributes after href", () => {
      const links = extractAllRawLinks(
        '<a href="/page" class="nav" rel="nofollow">link</a>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("https://site.com/page");
    });

    test("handles case-insensitive tag and attribute names", () => {
      const links = extractAllRawLinks(
        '<A HREF="/page">link</A>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("https://site.com/page");
    });

    test("strips hash fragment from normalized URL", () => {
      const links = extractAllRawLinks(
        '<a href="/page#section">link</a>',
        "https://site.com/",
      );
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("strips trailing slash from normalized URL", () => {
      const links = extractAllRawLinks(
        '<a href="/page/">link</a>',
        "https://site.com/",
      );
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("handles multiple trailing slashes", () => {
      const links = extractAllRawLinks(
        '<a href="//site.com/page///">link</a>',
        "https://site.com/",
      );
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("mailto link is extracted (valid URL scheme)", () => {
      const links = extractAllRawLinks(
        '<a href="mailto:test@example.com">email</a>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("mailto:test@example.com");
    });

    test("javascript protocol link is extracted (valid URL scheme)", () => {
      const links = extractAllRawLinks(
        '<a href="javascript:void(0)">js</a>',
        "https://site.com/",
      );
      expect(links).toHaveLength(1);
      expect(links[0].original).toBe("javascript:void(0)");
    });

    test("fragment-only href resolves to baseUrl", () => {
      const links = extractAllRawLinks(
        '<a href="#section">section</a>',
        "https://site.com/page",
      );
      expect(links[0].original).toBe("https://site.com/page#section");
      expect(links[0].normalized).toBe("https://site.com/page");
    });

    test("preserves scheme (http vs https)", () => {
      const links = extractAllRawLinks(
        '<a href="https://secure.com/page">secure</a>',
        "http://site.com/",
      );
      expect(links[0].original).toBe("https://secure.com/page");
    });

    test("handles href with URL-encoded chars", () => {
      const links = extractAllRawLinks(
        '<a href="/page%20with%20spaces">link</a>',
        "https://site.com/",
      );
      expect(links[0].original).toBe("https://site.com/page%20with%20spaces");
    });

    test("does not crash on unclosed <a> tag (missing >)", () => {
      const links = extractAllRawLinks(
        '<a href="/page"',
        "https://site.com/",
      );
      expect(links).toHaveLength(0);
    });

    test("extracts link from open <a> tag before text", () => {
      const links = extractAllRawLinks(
        '<a href="/page">link',
        "https://site.com/",
      );
      expect(links[0].original).toBe("https://site.com/page");
    });
  });
});
