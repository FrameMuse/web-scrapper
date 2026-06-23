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

      if (key === "selector" || key === "code-by") {
        const k = key === "code-by" ? "codeBy" : "selector";
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
});
