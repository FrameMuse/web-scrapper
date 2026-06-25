import { describe, test, expect } from "bun:test";

// Replicate parseArgs logic from cli.ts for testing
function parseArgs(args: string[]) {
  const flags: Record<string, string | string[] | number | boolean> = {};
  const positional: string[] = [];
  let hasFlags = false;

  for (const a of args) {
    if (a.startsWith("--")) {
      hasFlags = true;
      const eq = a.indexOf("=");
      let key: string, val: string;
      if (eq !== -1) {
        key = a.substring(2, eq);
        val = a.substring(eq + 1);
      } else {
        key = a.substring(2);
        val = "true";
      }

      if (key === "selector" || key === "code-by" || key === "exclude") {
        const map: Record<string, string> = { "code-by": "codeBy", exclude: "exclude" };
        const k = map[key] || "selector";
        if (!flags[k]) flags[k] = [];
        (flags[k] as string[]).push(val);
      } else if (
        key === "concurrent" ||
        key === "interval" ||
        key === "offset" ||
        key === "limit"
      ) {
        flags[key] = parseInt(val, 10);
      } else {
        flags[key] = val;
      }
    } else {
      positional.push(a);
    }
  }

  return { flags, positional, hasFlags };
}

describe("parseArgs", () => {
  test("single URL, no flags", () => {
    const r = parseArgs(["https://site.com/page"]);
    expect(r.positional).toEqual(["https://site.com/page"]);
    expect(r.hasFlags).toBe(false);
  });

  test("URL with selector flag", () => {
    const r = parseArgs([
      "--selector=.content",
      "https://site.com/page",
    ]);
    expect(r.positional).toEqual(["https://site.com/page"]);
    expect(r.hasFlags).toBe(true);
    expect(r.flags["selector"]).toEqual([".content"]);
  });

  test("multiple selectors", () => {
    const r = parseArgs([
      "--selector=.a",
      "--selector=.b",
      "https://site.com/page",
    ]);
    expect(r.flags["selector"]).toEqual([".a", ".b"]);
    expect(r.hasFlags).toBe(true);
  });

  test("numeric flags parsed as numbers", () => {
    const r = parseArgs([
      "--concurrent=5",
      "--interval=200",
      "--offset=10",
      "--limit=50",
    ]);
    expect(r.flags["concurrent"]).toBe(5);
    expect(r.flags["interval"]).toBe(200);
    expect(r.flags["offset"]).toBe(10);
    expect(r.flags["limit"]).toBe(50);
  });

  test("boolean flags", () => {
    const r = parseArgs(["--force", "--dry-run"]);
    expect(r.flags["force"]).toBe("true");
    expect(r.flags["dry-run"]).toBe("true");
  });

  test("output flag", () => {
    const r = parseArgs(["--output=./docs"]);
    expect(r.flags["output"]).toBe("./docs");
  });

  test("sitemap flag", () => {
    const r = parseArgs(["--sitemap=https://site.com/sitemap.xml"]);
    expect(r.flags["sitemap"]).toBe("https://site.com/sitemap.xml");
  });

  test("url-base flag", () => {
    const r = parseArgs(["--url-base=https://site.com/docs/"]);
    expect(r.flags["url-base"]).toBe("https://site.com/docs/");
  });

  test("no args", () => {
    const r = parseArgs([]);
    expect(r.positional).toEqual([]);
    expect(r.hasFlags).toBe(false);
    expect(Object.keys(r.flags).length).toBe(0);
  });

  test("pipe mode detection: no flags = pipe", () => {
    const r = parseArgs(["https://site.com/page"]);
    expect(r.hasFlags).toBe(false);
  });

  test("file mode detection: any flag = file", () => {
    const r = parseArgs(["--force", "https://site.com/page"]);
    expect(r.hasFlags).toBe(true);
  });

  test("single code-by", () => {
    const r = parseArgs(["--code-by=h3.property"]);
    expect(r.flags["codeBy"]).toEqual(["h3.property"]);
    expect(r.hasFlags).toBe(true);
  });

  test("multiple code-by", () => {
    const r = parseArgs(["--code-by=h3.property", "--code-by=.signature"]);
    expect(r.flags["codeBy"]).toEqual(["h3.property", ".signature"]);
    expect(r.hasFlags).toBe(true);
  });

  test("code-by with selector", () => {
    const r = parseArgs([
      "--code-by=h3.property",
      "--selector=div.content",
      "--url-base=https://x.com/docs/",
    ]);
    expect(r.flags["codeBy"]).toEqual(["h3.property"]);
    expect(r.flags["selector"]).toEqual(["div.content"]);
  });

  test("exclude flag (repeatable)", () => {
    const r = parseArgs([
      "--exclude=/wiki/(File|User):",
      "--exclude=action=history",
    ]);
    expect(r.flags["exclude"]).toEqual(["/wiki/(File|User):", "action=history"]);
  });

  test("save-images boolean flag", () => {
    const r = parseArgs(["--save-images"]);
    expect(r.flags["save-images"]).toBe("true");
  });

  test("build-map boolean flag", () => {
    const r = parseArgs(["--build-map"]);
    expect(r.flags["build-map"]).toBe("true");
  });

  test("skip-query boolean flag", () => {
    const r = parseArgs(["--skip-query"]);
    expect(r.flags["skip-query"]).toBe("true");
  });

  test("follow-links boolean flag", () => {
    const r = parseArgs(["--follow-links"]);
    expect(r.flags["follow-links"]).toBe("true");
  });

  test("chrome boolean flag", () => {
    const r = parseArgs(["--chrome"]);
    expect(r.flags["chrome"]).toBe("true");
  });

  test("url-filter string flag", () => {
    const r = parseArgs(["--url-filter=https://site.com/docs/"]);
    expect(r.flags["url-filter"]).toBe("https://site.com/docs/");
  });

  test("match regex flag", () => {
    const r = parseArgs(["--match=^(docs|api)/"]);
    expect(r.flags["match"]).toBe("^(docs|api)/");
  });

  test("all flags combined", () => {
    const r = parseArgs([
      "https://site.com/start",
      "--selector=main",
      "--selector=.content",
      "--exclude=/wiki/File:",
      "--exclude=action=edit",
      "--code-by=h3.title",
      "--url-base=https://site.com/wiki/",
      "--url-filter=https://site.com/wiki/",
      "--concurrent=3",
      "--interval=500",
      "--offset=10",
      "--limit=100",
      "--force",
      "--dry-run",
      "--follow-links",
      "--chrome",
      "--save-images",
      "--build-map",
      "--skip-query",
      "--output=~/docs",
      "--match=^(wiki)/",
    ]);
    expect(r.positional[0]).toBe("https://site.com/start");
    expect(r.flags["selector"]).toEqual(["main", ".content"]);
    expect(r.flags["exclude"]).toEqual(["/wiki/File:", "action=edit"]);
    expect(r.flags["codeBy"]).toEqual(["h3.title"]);
    expect(r.flags["url-base"]).toBe("https://site.com/wiki/");
    expect(r.flags["url-filter"]).toBe("https://site.com/wiki/");
    expect(r.flags["concurrent"]).toBe(3);
    expect(r.flags["interval"]).toBe(500);
    expect(r.flags["offset"]).toBe(10);
    expect(r.flags["limit"]).toBe(100);
    expect(r.flags["force"]).toBe("true");
    expect(r.flags["dry-run"]).toBe("true");
    expect(r.flags["follow-links"]).toBe("true");
    expect(r.flags["chrome"]).toBe("true");
    expect(r.flags["save-images"]).toBe("true");
    expect(r.flags["build-map"]).toBe("true");
    expect(r.flags["skip-query"]).toBe("true");
    expect(r.flags["output"]).toBe("~/docs");
    expect(r.flags["match"]).toBe("^(wiki)/");
    expect(r.hasFlags).toBe(true);
  });
});

describe("expandTilde", () => {
  const HOME = process.env.HOME || "/home/user";

  function expandTilde(s: string): string {
    return s.startsWith("~") ? s.replace("~", HOME) : s;
  }

  test("expands tilde to HOME", () => {
    expect(expandTilde("~/docs")).toBe(HOME + "/docs");
    expect(expandTilde("~/a/b/c")).toBe(HOME + "/a/b/c");
  });

  test("leaves non-tilde paths unchanged", () => {
    expect(expandTilde("/abs/path")).toBe("/abs/path");
    expect(expandTilde("./rel/path")).toBe("./rel/path");
  });

  test("leaves empty string unchanged", () => {
    expect(expandTilde("")).toBe("");
  });
});

describe("isExcluded", () => {
  function isExcluded(url: string, patterns: string[]): boolean {
    return patterns.some((p) => {
      try {
        return new RegExp(p).test(url);
      } catch {
        return false;
      }
    });
  }

  const patterns = [
    "/wiki/(File|User|Help|Talk|Template|MediaWiki|Module|Thread)(_[^/]+)*:",
    "action=history",
  ];

  test("matches File namespace URL", () => {
    expect(isExcluded("https://wiki.com/wiki/File:Image.png", patterns)).toBe(true);
  });

  test("matches User namespace URL", () => {
    expect(isExcluded("https://wiki.com/wiki/User:John", patterns)).toBe(true);
  });

  test("matches action=history URL", () => {
    expect(isExcluded("https://wiki.com/wiki/Page?action=history", patterns)).toBe(true);
  });

  test("does not match normal page URL", () => {
    expect(isExcluded("https://wiki.com/wiki/Airborne", patterns)).toBe(false);
  });

  test("does not match cross-namespace URL", () => {
    expect(isExcluded("https://wiki.com/wiki/FileSomething", patterns)).toBe(false);
  });

  test("handles invalid regex pattern gracefully", () => {
    expect(isExcluded("https://wiki.com/page", ["[invalid"])).toBe(false);
  });

  test("empty patterns list", () => {
    expect(isExcluded("https://wiki.com/page", [])).toBe(false);
  });
});

describe("filterUrls", () => {
  function filterUrls(
    urls: string[],
    urlFilter: string | undefined,
    offset: number,
    limit: number | undefined,
  ): string[] {
    let filtered = urlFilter ? urls.filter((u) => u.startsWith(urlFilter)) : urls;
    filtered = filtered.filter((u) => !/\/page\/\d+\/$/.test(u));
    if (offset > 0) filtered = filtered.slice(offset);
    if (limit !== undefined) filtered = filtered.slice(0, limit);
    return filtered;
  }

  const urls = [
    "https://site.com/wiki/Page1",
    "https://site.com/wiki/Page2",
    "https://site.com/wiki/Page3",
    "https://site.com/blog/page/2/",
    "https://site.com/blog/page/3/",
    "https://other.com/page",
  ];

  test("filters by urlFilter prefix", () => {
    const result = filterUrls(urls, "https://site.com/wiki/", 0, undefined);
    expect(result).toEqual([
      "https://site.com/wiki/Page1",
      "https://site.com/wiki/Page2",
      "https://site.com/wiki/Page3",
    ]);
  });

  test("excludes pagination URLs", () => {
    const result = filterUrls(urls, "https://site.com/", 0, undefined);
    expect(result).not.toContain("https://site.com/blog/page/2/");
    expect(result).not.toContain("https://site.com/blog/page/3/");
  });

  test("applies offset", () => {
    const result = filterUrls(urls, "https://site.com/wiki/", 1, undefined);
    expect(result).toEqual([
      "https://site.com/wiki/Page2",
      "https://site.com/wiki/Page3",
    ]);
  });

  test("applies limit", () => {
    const result = filterUrls(urls, "https://site.com/wiki/", 0, 2);
    expect(result).toEqual([
      "https://site.com/wiki/Page1",
      "https://site.com/wiki/Page2",
    ]);
  });

  test("offset + limit combined", () => {
    const result = filterUrls(urls, "https://site.com/wiki/", 1, 1);
    expect(result).toEqual(["https://site.com/wiki/Page2"]);
  });

  test("no urlFilter returns all non-pagination urls", () => {
    const result = filterUrls(urls, undefined, 0, undefined);
    expect(result.length).toBe(4);
    expect(result).toContain("https://other.com/page");
  });
});

describe("stripExcludedLinks", () => {
  function isExcluded(url: string): boolean {
    return /\/wiki\/(File|User):/.test(url);
  }

  function stripExcludedLinks(html: string): string {
    return html.replace(
      /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>[\s\S]*?<\/a>\s*/gi,
      (match, dq, sq) => (isExcluded(dq ?? sq) ? "" : match),
    );
  }

  test("removes excluded link with text content", () => {
    const html = '<a href="https://wiki.com/wiki/File:Image.png">View file</a>\n<p>content</p>';
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("View file");
    expect(result).toContain("<p>content</p>");
  });

  test("removes excluded link with nested img", () => {
    const html = '<a href="https://wiki.com/wiki/File:Icon.svg"><img src="icon.svg"></a>\n<p>text</p>';
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("<img");
    expect(result).toContain("<p>text</p>");
  });

  test("removes excluded link with nested span and img", () => {
    const html = '<a href="https://wiki.com/wiki/File:Photo.jpg"><span><img src="photo.jpg"></span></a>\n<p>body</p>';
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("<span>");
    expect(result).toContain("<p>body</p>");
  });

  test("preserves non-excluded link", () => {
    const html = '<a href="https://wiki.com/wiki/Airborne">Paratroopers</a>\n<p>text</p>';
    const result = stripExcludedLinks(html);
    expect(result).toContain("Paratroopers");
    expect(result).toContain("<p>text</p>");
  });

  test("preserves non-excluded link with img", () => {
    const html = '<a href="https://wiki.com/wiki/Airborne"><img src="badge.png"></a>\n<p>text</p>';
    const result = stripExcludedLinks(html);
    expect(result).toContain('<img src="badge.png"');
    expect(result).toContain("<p>text</p>");
  });

  test("handles empty HTML", () => {
    expect(stripExcludedLinks("")).toBe("");
  });

  test("handles HTML with no links", () => {
    const html = "<p>Just text</p>";
    expect(stripExcludedLinks(html)).toBe(html);
  });

  test("removes multiple excluded links", () => {
    const html = [
      '<a href="https://wiki.com/wiki/File:A.png">A</a>',
      '<a href="https://wiki.com/wiki/Airborne">OK</a>',
      '<a href="https://wiki.com/wiki/User:Bob">B</a>',
    ].join("\n");
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("File:A");
    expect(result).toContain("Airborne");
    expect(result).not.toContain("User:Bob");
  });

  test("stripExcludedLinks handles single-quoted href", () => {
    const html = '<a href=\'https://wiki.com/wiki/File:Icon.svg\'><img src="icon.svg"></a>';
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("<img");
  });

  test("stripExcludedLinks handles double-quoted href", () => {
    const html = '<a href="https://wiki.com/wiki/File:Photo.jpg">photo</a>';
    const result = stripExcludedLinks(html);
    expect(result).not.toContain("photo");
  });
});
