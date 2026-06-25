import { describe, test, expect } from "bun:test";
import {
  isMediaLink,
  normalizeUrl,
  extractAllRawLinks,
} from "../lib/links.ts";
import { addToMap } from "../lib/linkMap.ts";

describe("links module", () => {
  test("isMediaLink filters image extensions", () => {
    expect(isMediaLink("https://site.com/image.jpg")).toBe(true);
    expect(isMediaLink("https://site.com/image.png")).toBe(true);
    expect(isMediaLink("https://site.com/image.gif")).toBe(true);
    expect(isMediaLink("https://site.com/image.svg")).toBe(true);
    expect(isMediaLink("https://site.com/page.html")).toBe(false);
    expect(isMediaLink("https://site.com/page.php")).toBe(false);
  });

  test("normalizeUrl strips hash and adds trailing slash", () => {
    expect(normalizeUrl("https://site.com/page#anchor")).toBe("https://site.com/page/");
    expect(normalizeUrl("https://site.com/page/")).toBe("https://site.com/page/");
    expect(normalizeUrl("https://site.com/page")).toBe("https://site.com/page/");
  });

  test("extractAllRawLinks with urlFilter", () => {
    const html = '<a href="/wiki/page1">P1</a><a href="/wiki/page2">P2</a>';
    const links = extractAllRawLinks(html, "https://site.com/wiki/", "https://site.com/wiki/", false);
    expect(links.length).toBe(2);
    expect(links[0].original).toBe("https://site.com/wiki/page1");
    expect(links[0].normalized).toBe("https://site.com/wiki/page1/");
  });

  test("extractAllRawLinks with skipQuery", () => {
    const html = '<a href="/wiki/page?ref=nav">P</a>';
    const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/", true);
    expect(links.length).toBe(1);
    // original preserves the exact resolved URL including query
    expect(links[0].original).toBe("https://site.com/wiki/page?ref=nav");
    // normalized strips query for dedup
    expect(links[0].normalized).toBe("https://site.com/wiki/page/");
  });

  test("extractAllRawLinks preserves original query string", () => {
    const html = '<a href="/wiki/page?action=edit">Edit</a>';
    const links = extractAllRawLinks(html, "https://site.com/", undefined, false);
    expect(links[0].original).toBe("https://site.com/wiki/page?action=edit");
  });

  test("extractAllRawLinks handles single-quoted href", () => {
    const html = "<a href='/wiki/page1'>P1</a>";
    const links = extractAllRawLinks(html, "https://site.com/wiki/", "https://site.com/wiki/", false);
    expect(links.length).toBe(1);
    expect(links[0].original).toBe("https://site.com/wiki/page1");
  });

  test("extractAllRawLinks handles mixed quote styles", () => {
    const html = '<a href="/wiki/a">A</a><a href=\'/wiki/b\'>B</a>';
    const links = extractAllRawLinks(html, "https://site.com/wiki/", "https://site.com/wiki/", false);
    expect(links.length).toBe(2);
    expect(links[0].original).toBe("https://site.com/wiki/a");
    expect(links[1].original).toBe("https://site.com/wiki/b");
  });

  test("extractAllRawLinks preserves original when skipQuery is true", () => {
    const html = '<a href="/wiki/page?cb=123&ref=nav">P</a>';
    const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/", true);
    expect(links.length).toBe(1);
    // original keeps exact query for fetchHtml navigation
    expect(links[0].original).toBe("https://site.com/wiki/page?cb=123&ref=nav");
    // normalized strips query for dedup
    expect(links[0].normalized).toBe("https://site.com/wiki/page/");
  });

  test("extractAllRawLinks deduplicates by normalized URL", () => {
    const html = '<a href="/wiki/page">P</a><a href="/wiki/page/">P</a><a href="/wiki/page#hash">P</a>';
    const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/", false);
    expect(links.length).toBe(1);
  });

  test("addToMap accepts extracted links", () => {
    const html = '<a href="/wiki/a">A</a><a href="/wiki/b">B</a>';
    const links = extractAllRawLinks(html, "https://site.com/", "https://site.com/", false);
    const map = {};
    addToMap(map, links.map((l) => l.normalized));
    expect(Object.keys(map).length).toBe(2);
  });
});
