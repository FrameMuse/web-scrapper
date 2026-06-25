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
    expect(links[0].original).toBe("https://site.com/wiki/page");
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
