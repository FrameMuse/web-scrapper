import { describe, test, expect, afterAll } from "bun:test";
import { unlinkSync, readFileSync } from "fs";
import { LinkCsv } from "../lib/linkCsv";

let counter = 0;
function tmpPath(): string {
  counter++;
  return `/tmp/test-linkcsv-${counter}.csv`;
}

afterAll(() => {
  for (let i = 1; i <= counter; i++) {
    try { unlinkSync(`/tmp/test-linkcsv-${i}.csv`); } catch {}
  }
});

describe("LinkCsv", () => {
  test("append and load single entry", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/Page", "text/html");
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.size()).toBe(1);
    expect(csv2.urlToLine.has("https://site.com/wiki/Page")).toBe(true);
    csv2.close();
  });

  test("append multiple entries", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/A", "text/html");
    csv.append("https://site.com/wiki/B", "text/html");
    csv.append("https://site.com/img.jpg", "image/jpeg");
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.size()).toBe(3);
    csv2.close();
  });

  test("append dedup — same URL ignored", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/Dedup", "text/html");
    csv.append("https://site.com/wiki/Dedup", "text/html");
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.size()).toBe(1);
    csv2.close();
  });

  test("mark visited updates in place", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/V", "text/html");
    csv.markVisited("https://site.com/wiki/V");
    expect(csv.visitedSet().has("https://site.com/wiki/V")).toBe(true);
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.visitedSet().has("https://site.com/wiki/V")).toBe(true);
    csv2.close();
  });

  test("mark processed updates in place", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/P", "text/html");
    csv.markVisited("https://site.com/wiki/P");
    csv.markProcessed("https://site.com/wiki/P");
    expect(csv.processedSet().has("https://site.com/wiki/P")).toBe(true);
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.processedSet().has("https://site.com/wiki/P")).toBe(true);
    csv2.close();
  });

  test("unprocessedVisited returns queue for resume", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/Done", "text/html");
    csv.markVisited("https://site.com/wiki/Done");
    csv.markProcessed("https://site.com/wiki/Done");

    csv.append("https://site.com/wiki/Unprocessed", "text/html");
    csv.markVisited("https://site.com/wiki/Unprocessed");

    csv.append("https://site.com/wiki/NotVisited", "text/html");

    const queue = csv.unprocessedVisited();
    expect(queue).toEqual(["https://site.com/wiki/Unprocessed"]);
    csv.close();
  });

  test("visitedSet and processedSet", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/A", "text/html");
    csv.markVisited("https://site.com/wiki/A");
    csv.markProcessed("https://site.com/wiki/A");

    csv.append("https://site.com/wiki/B", "text/html");
    csv.markVisited("https://site.com/wiki/B");

    expect(csv.visitedSet().size).toBe(2);
    expect(csv.processedSet().size).toBe(1);
    csv.close();
  });

  test("URLs with special characters", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    const url = "https://site.com/wiki/Page?q=a&b=c#frag";
    csv.append(url, "text/html");
    csv.markVisited(url);
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.urlToLine.has(url)).toBe(true);
    expect(csv2.visitedSet().has(url)).toBe(true);
    csv2.close();
  });

  test("empty file loads cleanly", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    expect(csv.size()).toBe(0);
    expect(csv.visitedSet().size).toBe(0);
    expect(csv.processedSet().size).toBe(0);
    expect(csv.unprocessedVisited().length).toBe(0);
    csv.close();
  });

  test("file size stays constant after updates", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/SizeTest", "text/html");

    const size1 = readFileSync(p).length;
    csv.markVisited("https://site.com/wiki/SizeTest");
    const size2 = readFileSync(p).length;
    expect(size2).toBe(size1);

    csv.markProcessed("https://site.com/wiki/SizeTest");
    const size3 = readFileSync(p).length;
    expect(size3).toBe(size1);

    csv.close();
  });

  test("urlToCt tracks content types", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/image.jpg", "image/jpeg");
    csv.append("https://site.com/page", "text/html; charset=utf-8");
    expect(csv.urlToCt.get("https://site.com/image.jpg")).toBe("image/jpeg");
    expect(csv.urlToCt.get("https://site.com/page")).toBe("text/html; charset=utf-8");

    csv.markVisited("https://site.com/page", "text/html");
    expect(csv.urlToCt.get("https://site.com/page")).toBe("text/html");
    csv.close();
  });

  test("mark on unknown URL is no-op", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.markVisited("https://site.com/unknown");
    csv.markProcessed("https://site.com/unknown");
    expect(csv.size()).toBe(0);
    csv.close();
  });

  test("load picks latest line for duplicate URLs", () => {
    const p = tmpPath();
    const csv = new LinkCsv(p);
    csv.load();
    csv.append("https://site.com/wiki/Last", "text/html");
    csv.markVisited("https://site.com/wiki/Last");
    csv.markProcessed("https://site.com/wiki/Last");
    csv.close();

    const csv2 = new LinkCsv(p);
    csv2.load();
    expect(csv2.visitedSet().has("https://site.com/wiki/Last")).toBe(true);
    expect(csv2.processedSet().has("https://site.com/wiki/Last")).toBe(true);
    csv2.close();
  });
});
