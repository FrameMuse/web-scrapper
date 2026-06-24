import { describe, test, expect } from "bun:test";
import { rewriteLinks } from "../lib/linkRewrite.ts";

const BASE = "https://site.com/docs/";

describe("rewriteLinks", () => {
  test("same directory", () => {
    const md = "See [other page](/docs/other/)";
    const result = rewriteLinks(md, "https://site.com/docs/page/", BASE);
    expect(result).toContain("](other.md)");
  });

  test("subdirectory down", () => {
    const md = "See [api ref](/docs/api/ref/)";
    const result = rewriteLinks(md, "https://site.com/docs/page/", BASE);
    expect(result).toContain("](api/ref.md)");
  });

  test("subdirectory up", () => {
    const md = "See [intro](/docs/intro/)";
    const result = rewriteLinks(md, "https://site.com/docs/api/ref/", BASE);
    expect(result).toContain("](../intro.md)");
  });

  test("shared prefix", () => {
    const md = "See [other](/docs/api/other/)";
    const result = rewriteLinks(md, "https://site.com/docs/api/ref/", BASE);
    expect(result).toContain("](other.md)");
  });

  test("fragment preserved", () => {
    const md = "See [section](/docs/page/#section)";
    const result = rewriteLinks(md, "https://site.com/docs/", BASE);
    expect(result).toContain("](page.md#section)");
  });

  test("link outside base not rewritten", () => {
    const md = "See [external](https://other.com/page/)";
    const result = rewriteLinks(md, "https://site.com/docs/", BASE);
    expect(result).toBe(md);
  });

  test("multiple links", () => {
    const md = "[a](/docs/a/) and [b](/docs/b/)";
    const result = rewriteLinks(md, "https://site.com/docs/", BASE);
    expect(result).toContain("](a.md)");
    expect(result).toContain("](b.md)");
  });

  test("link to root index", () => {
    const md = "[home](/docs/)";
    const result = rewriteLinks(md, "https://site.com/docs/page/", BASE);
    expect(result).toContain("](index.md)");
  });

  test("self link", () => {
    const md = "[self](/docs/page/)";
    const result = rewriteLinks(md, "https://site.com/docs/page/", BASE);
    expect(result).toContain("](page.md)");
  });

  test("link with title attribute", () => {
    const md = 'See [British Units](/wiki/Category:British_Units "Category:British Units")';
    const result = rewriteLinks(md, "https://site.com/docs/page/", "https://site.com/wiki/");
    // Title should be preserved but .md placed before it
    expect(result).toContain('.md "Category:British Units")');
    expect(result).not.toContain('.md"');
  });

  test("link without title", () => {
    const md = "See [page](/docs/page)";
    const result = rewriteLinks(md, "https://site.com/docs/", "https://site.com/docs/");
    expect(result).toContain("](page.md)");
  });
});
