import { describe, test, expect } from "bun:test";
import { extract, DEFAULT_SELECTORS } from "../lib/extract.ts";

// ---- parseCssSelector ----

function parseCssSelector(sel: string) {
  const parts = sel.split(/(?=[#.])/);
  let tag = "div";
  let id: string | undefined;
  const classes: string[] = [];
  for (const p of parts) {
    if (p.startsWith(".")) classes.push(p.slice(1));
    else if (p.startsWith("#")) id = p.slice(1);
    else tag = p;
  }
  return { tag, id, classes };
}

describe("parseCssSelector", () => {
  test("class only", () => {
    const r = parseCssSelector(".foo");
    expect(r.tag).toBe("div");
    expect(r.classes).toEqual(["foo"]);
    expect(r.id).toBeUndefined();
  });

  test("id only", () => {
    const r = parseCssSelector("#bar");
    expect(r.tag).toBe("div");
    expect(r.id).toBe("bar");
    expect(r.classes).toEqual([]);
  });

  test("tag + class", () => {
    const r = parseCssSelector("div.foo");
    expect(r.tag).toBe("div");
    expect(r.classes).toEqual(["foo"]);
  });

  test("tag + id + multiple classes", () => {
    const r = parseCssSelector("div#bar.baz.qux");
    expect(r.tag).toBe("div");
    expect(r.id).toBe("bar");
    expect(r.classes).toEqual(["baz", "qux"]);
  });

  test("bare tag", () => {
    const r = parseCssSelector("article");
    expect(r.tag).toBe("article");
    expect(r.id).toBeUndefined();
    expect(r.classes).toEqual([]);
  });
});

// ---- extract ----

describe("extract selectors", () => {
  const html =
    '<html><body><div class="content"><h1>Title</h1><p>Body text</p></div></body></html>';

  test("matching selector returns content", () => {
    const r = extract(html, [".content"]);
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toContain("<h1>Title</h1>");
    expect(r!.title).toBe("");
  });

  test("non-matching selector returns null", () => {
    const r = extract(html, [".nonexistent"]);
    expect(r).toBeNull();
  });

  test("first match wins", () => {
    const r = extract(html, [".nonexistent", ".content", "body"]);
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toContain("<h1>Title</h1>");
  });

  test("empty selectors uses defaults", () => {
    const r = extract(html, []);
    expect(r).not.toBeNull();
  });
});

describe("extract with --match override", () => {
  const html = "<p>Hello <strong>world</strong></p><div>Footer</div>";

  test("regex with capture group", () => {
    const r = extract(html, [], "<p>([\\s\\S]*?)</p>");
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toBe("Hello <strong>world</strong>");
  });

  test("regex without match returns null", () => {
    const r = extract(html, [], "<span>([\\s\\S]*?)</span>");
    expect(r).toBeNull();
  });
});

describe("extract metadata", () => {
  const html = `<!DOCTYPE html>
<html>
<head>
<title>Test Page | Site Name</title>
<meta name="description" content="A test description">
<meta property="article:published_time" content="2024-03-15T10:00:00Z">
</head>
<body><div class="content"><p>Body</p></div></body>
</html>`;

  test("extracts title without site suffix", () => {
    const r = extract(html, [".content"]);
    expect(r!.title).toBe("Test Page");
  });

  test("extracts description", () => {
    const r = extract(html, [".content"]);
    expect(r!.description).toBe("A test description");
  });

  test("extracts date from meta", () => {
    const r = extract(html, [".content"]);
    expect(r!.date).toBe("2024-03-15");
  });

  test("extracts date from time tag", () => {
    const htmlWithTime =
      '<html><body><article><header><time datetime="2023-01-01T00:00:00Z">Jan 1</time></header><div class="content"><p>Body</p></div></article></body></html>';
    const r = extract(htmlWithTime, [".content"]);
    expect(r!.date).toBe("2023-01-01");
  });
});

describe("extract with nested tags", () => {
  test("balanced div tags", () => {
    const html =
      '<div class="outer"><div class="inner"><p>Content</p></div></div>';
    const r = extract(html, [".outer"]);
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toContain("<div class=\"inner\">");
    expect(r!.contentHtml).toContain("</div>");
  });

  test("article boundary", () => {
    const html =
      "<article><header><h1>Title</h1></header><div class=\"post\"><p>Body</p></div></article>";
    const r = extract(html, [".post"]);
    expect(r).not.toBeNull();
    expect(r!.contentHtml).toContain("<h1>Title</h1>");
  });
});

describe("extract DEFAULT_SELECTORS", () => {
  test("includes common containers", () => {
    expect(DEFAULT_SELECTORS).toContain("article");
    expect(DEFAULT_SELECTORS).toContain("main");
    expect(DEFAULT_SELECTORS).toContain(".content");
    expect(DEFAULT_SELECTORS).toContain("body");
  });
});
