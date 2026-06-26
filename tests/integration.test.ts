import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { extract } from "../lib/extract.ts";
import { rewriteLinks } from "../lib/linkRewrite.ts";
import { renderFrontmatter } from "../lib/frontmatter.ts";
import { urlToPath } from "../lib/save.ts";

const CONVERTER = "rust-converter/target/release/html-to-md";

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
  });

  test("content does not expand to article boundary", () => {
    const r = extract(updateHtml, [
      "div.theme-doc-markdown.markdown",
      "div#__blog-post-container.markdown",
    ]);
    expect(r).not.toBeNull();
    // Title and date live in <article><header>, outside the matched div
    expect(r!.contentHtml).not.toContain("Version 1, Update 1");
    expect(r!.contentHtml).not.toContain("August 21, 2019");
    expect(r!.contentHtml).toContain("first update to the plugins API");
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

describe("code-by feature (Rust converter)", () => {
  test("code-by wraps property content in backticks", () => {
    const html = `<h3 id="annotations" data-property="true" class="property">annotations: ReadonlyArray&lt;<a href="/docs/Annotation/">Annotation</a>&gt;</h3>`;
    const proc = spawnSync(CONVERTER, ["h3.property"], {
      input: html,
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
    const out = proc.stdout;
    expect(out).toContain("`annotations");
    expect(out).toContain("ReadonlyArray<");
    expect(out).toContain("[Annotation]");
  });

  test("code-by splits backticks around links", () => {
    const html = `<h3 class="property">type: <a href="/docs/Foo/">Foo</a></h3>`;
    const proc = spawnSync(CONVERTER, ["h3.property"], {
      input: html,
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
    // Code span split around link: `type: `[Foo](Foo.md)
    const out = proc.stdout;
    expect(out).toMatch(/`[^`]*type/);
    expect(out).toContain("[Foo]");
    expect(out).toMatch(/\`[^`]*$/); // trailing backtick after link
  });

  test("code-by no match when class absent", () => {
    const html = `<h3>plain heading</h3>`;
    const proc = spawnSync(CONVERTER, ["h3.property"], {
      input: html,
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
    // Without matching class, heading is not code-wrapped
    expect(proc.stdout).toMatch(/^### plain/);
    expect(proc.stdout).not.toContain("`plain");
  });

  test("code-by multiple selectors", () => {
    const html = `<h3 class="sig">a: string</h3><h3 class="property">b: number</h3>`;
    const proc = spawnSync(CONVERTER, [".sig", "h3.property"], {
      input: html,
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
    const out = proc.stdout;
    expect(out).toMatch(/### `a: string`/);
    expect(out).toMatch(/### `b: number`/);
  });

  test("code-by preserves links inside code split", () => {
    const html =
      `<h3 class="property">` +
      `<a href="/docs/api/foo/"><code>foo</code></a>` +
      `: <a href="/docs/api/Bar/"><code>Bar</code></a></h3>`;
    const proc = spawnSync(CONVERTER, ["h3.property"], {
      input: html,
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
    // Links should be preserved as markdown links between code spans
    // Output pattern: [`foo`](foo.md): [`Bar`](Bar.md)
    const out = proc.stdout;
    expect(out).toContain("[`foo`]");
    expect(out).toContain("[`Bar`]");
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
