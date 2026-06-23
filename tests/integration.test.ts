import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { extract } from "../lib/extract.ts";
import { rewriteLinks } from "../lib/linkRewrite.ts";
import { renderFrontmatter } from "../lib/frontmatter.ts";
import { urlToPath } from "../lib/save.ts";

const FIXTURES = "tests/fixtures";
const BASE = "https://developers.figma.com/docs/plugins/";

let docHtml: string;
let updateHtml: string;

beforeAll(() => {
  docHtml = readFileSync(`${FIXTURES}/prerequisites.html`, "utf-8");
  updateHtml = readFileSync(`${FIXTURES}/update-1.html`, "utf-8");
});

describe("prerequisites page (doc)", () => {
  test("extracts with doc selector", () => {
    const r = extract(docHtml, [
      "div.theme-doc-markdown.markdown",
      "div#__blog-post-container.markdown",
    ]);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Prerequisites");
    expect(r!.description).toContain("Figma plugins are lightweight");
    expect(r!.contentHtml).toContain("<h1>Prerequisites</h1>");
    expect(r!.contentHtml).not.toContain("breadcrumbs");
  });

  test("converts to markdown-like output", () => {
    const r = extract(docHtml, ["div.theme-doc-markdown.markdown"]);
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toContain("<h1>");
    expect(r!.contentHtml).toContain("<strong>");
    expect(r!.contentHtml).toContain("<a href=");
  });

  test("links rewrite correctly", () => {
    const r = extract(docHtml, ["div.theme-doc-markdown.markdown"]);
    expect(r).not.toBeNull();
    // We can't test full MD conversion here (needs Rust binary),
    // but we can verify the extracted HTML has expected link patterns
    expect(r!.contentHtml).toContain('href="/docs/plugins/');
  });
});

describe("update page (blog)", () => {
  test("extracts with blog selector", () => {
    const r = extract(updateHtml, [
      "div.theme-doc-markdown.markdown",
      "div#__blog-post-container.markdown",
    ]);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Version 1, Update 1");
    expect(r!.date).toBe("2019-08-21");
    expect(r!.contentHtml).toContain("Version 1, Update 1");
  });

  test("includes article header for blog layout", () => {
    const r = extract(updateHtml, [
      "div.theme-doc-markdown.markdown",
      "div#__blog-post-container.markdown",
    ]);
    expect(r).not.toBeNull();
    // Should include the H1 from article > header (has class attr in real HTML)
    expect(r!.contentHtml).toContain("Version 1, Update 1");
    // Should include the date text
    expect(r!.contentHtml).toContain("August 21, 2019");
  });
});

describe("urlToPath integration", () => {
  test("prerequisites path", () => {
    const p = urlToPath(
      "https://developers.figma.com/docs/plugins/prerequisites/",
      BASE
    );
    expect(p).toBe("prerequisites");
  });

  test("update path", () => {
    const p = urlToPath(
      "https://developers.figma.com/docs/plugins/updates/2019/08/21/version-1-update-1/",
      BASE
    );
    expect(p).toBe("updates/2019/08/21/version-1-update-1");
  });

  test("api path", () => {
    const p = urlToPath(
      "https://developers.figma.com/docs/plugins/api/figma/",
      BASE
    );
    expect(p).toBe("api/figma");
  });

  test("root index path", () => {
    const p = urlToPath(
      "https://developers.figma.com/docs/plugins/",
      BASE
    );
    expect(p).toBe("index");
  });
});

describe("frontmatter integration", () => {
  test("prerequisites frontmatter", () => {
    const r = extract(docHtml, ["div.theme-doc-markdown.markdown"]);
    const fm = renderFrontmatter({
      title: r!.title,
      description: r!.description,
      source: "https://developers.figma.com/docs/plugins/prerequisites/",
    });
    expect(fm).toContain('title: "Prerequisites"');
    expect(fm).toContain("source: https://developers.figma.com");
    expect(fm).toMatch(/---\n$/);
  });
});

describe("real-world link rewrite patterns", () => {
  test("prerequisites internal links rewrite", () => {
    // Simulate what the MD converter would output
    const mdContent =
      "See [async tasks](/docs/plugins/async-tasks/) and [manifest](/docs/plugins/manifest/)";
    const result = rewriteLinks(
      mdContent,
      "https://developers.figma.com/docs/plugins/prerequisites/",
      BASE
    );
    expect(result).toContain("](async-tasks.md)");
    expect(result).toContain("](manifest.md)");
  });
});
