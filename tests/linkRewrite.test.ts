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

describe("rewriteLinks hoisted reference definitions", () => {
  test("reference with relative URL", () => {
    const md = "[vehicles]: /docs/Guides/Vehicles";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe("[vehicles]: Guides/Vehicles.md");
  });

  test("reference with absolute URL", () => {
    const md = "[ref0]: https://site.com/docs/Tanks";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe("[ref0]: Tanks.md");
  });

  test("reference with nested path (source deeper)", () => {
    const md = "[ref0]: /docs/Tanks";
    const result = rewriteLinks(md, "https://site.com/docs/Guides/Page", BASE);
    expect(result).toBe("[ref0]: ../Tanks.md");
  });

  test("reference same directory", () => {
    const md = "[ref0]: /docs/Guides/Vehicles";
    const result = rewriteLinks(md, "https://site.com/docs/Guides/Page", BASE);
    expect(result).toBe("[ref0]: Vehicles.md");
  });

  test("reference with title preserved", () => {
    const md = '[ref0]: /docs/Tanks "Heavy armor"';
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe('[ref0]: Tanks.md "Heavy armor"');
  });

  test("reference root link becomes index", () => {
    const md = "[ref0]: /docs/";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe("[ref0]: index.md");
  });

  test("reference external URL not rewritten", () => {
    const md = "[ref0]: https://other.com/blog";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe(md);
  });

  test("reference outside base not rewritten", () => {
    const md = "[ref0]: /other/Tanks";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe(md);
  });

  test("mixed — some rewritten, some not", () => {
    const md = "[ref0]: /docs/A\n[ref1]: https://ext.com/B\n[ref2]: /docs/Guides/C\n[ref3]: /other/D";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    const lines = result.split("\n");
    expect(lines[0]).toBe("[ref0]: A.md");
    expect(lines[1]).toBe("[ref1]: https://ext.com/B");
    expect(lines[2]).toBe("[ref2]: Guides/C.md");
    expect(lines[3]).toBe("[ref3]: /other/D");
  });

  test("multiple references all rewritten", () => {
    const md = "[ref0]: /docs/A\n[ref1]: /docs/B\n[ref2]: /docs/Guides/C";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toBe("[ref0]: A.md\n[ref1]: B.md\n[ref2]: Guides/C.md");
  });

  test("empty input unchanged", () => {
    expect(rewriteLinks("", "https://site.com/docs/Page", BASE)).toBe("");
  });

  test("no ref definitions — only inline links", () => {
    const md = "See [Tanks](/docs/Tanks) and [Infantry](/docs/Infantry)";
    const result = rewriteLinks(md, "https://site.com/docs/Page", BASE);
    expect(result).toContain("](Tanks.md)");
    expect(result).toContain("](Infantry.md)");
  });
});
