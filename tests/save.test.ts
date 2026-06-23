import { describe, test, expect } from "bun:test";
import { urlToPath } from "../lib/save.ts";

const BASE = "https://site.com/docs/";

describe("urlToPath", () => {
  test("root page becomes index", () => {
    const r = urlToPath("https://site.com/docs/", BASE);
    expect(r).toBe("index");
  });

  test("top-level page", () => {
    const r = urlToPath("https://site.com/docs/page/", BASE);
    expect(r).toBe("page");
  });

  test("nested page", () => {
    const r = urlToPath("https://site.com/docs/a/b/", BASE);
    expect(r).toBe("a/b");
  });

  test("deeply nested", () => {
    const r = urlToPath("https://site.com/docs/x/y/z/", BASE);
    expect(r).toBe("x/y/z");
  });

  test("trailing slashes stripped", () => {
    const r = urlToPath("https://site.com/docs/foo/bar/", BASE);
    expect(r).toBe("foo/bar");
  });

  test("no trailing slash on input", () => {
    const r = urlToPath("https://site.com/docs/page", BASE);
    expect(r).toBe("page");
  });

  test("URL outside base", () => {
    const r = urlToPath("https://other.com/docs/page/", BASE);
    expect(r).toBe("page");
  });

  test("filename-like path", () => {
    const r = urlToPath("https://site.com/docs/api-reference/", BASE);
    expect(r).toBe("api-reference");
  });
});
