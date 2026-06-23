import { describe, test, expect } from "bun:test";
import { diffUrls } from "../lib/sitemap.ts";

describe("diffUrls", () => {
  test("new URLs detected", () => {
    const newUrls = ["/a", "/b", "/c"];
    const cached = ["/a"];
    const r = diffUrls(newUrls, cached);
    expect(r).toEqual(["/b", "/c"]);
  });

  test("all new when cache empty", () => {
    const newUrls = ["/a", "/b"];
    const r = diffUrls(newUrls, []);
    expect(r).toEqual(["/a", "/b"]);
  });

  test("none new when all cached", () => {
    const newUrls = ["/a", "/b"];
    const cached = ["/a", "/b"];
    const r = diffUrls(newUrls, cached);
    expect(r).toEqual([]);
  });

  test("removed URLs not included", () => {
    const newUrls = ["/a"];
    const cached = ["/a", "/b"];
    const r = diffUrls(newUrls, cached);
    expect(r).toEqual([]);
  });

  test("ordering preserved", () => {
    const newUrls = ["/c", "/a", "/b"];
    const cached = ["/a"];
    const r = diffUrls(newUrls, cached);
    expect(r).toEqual(["/c", "/b"]);
  });

  test("duplicates in new handled", () => {
    const newUrls = ["/a", "/a"];
    const cached = ["/a"];
    const r = diffUrls(newUrls, cached);
    expect(r).toEqual([]);
  });
});
