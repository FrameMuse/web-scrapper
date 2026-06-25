import { describe, test, expect, afterAll } from "bun:test";
import { unlinkSync, existsSync, readFileSync } from "fs";
import { LinkDb } from "../lib/linkDb.ts";

let counter = 0;
function tmpPath(): string {
  counter++;
  return `/tmp/test-linkdb-${counter}.sqlite.db`;
}

afterAll(() => {
  for (let i = 1; i <= counter; i++) {
    try { unlinkSync(`/tmp/test-linkdb-${i}.sqlite.db`); } catch {}
    try { unlinkSync(`/tmp/test-linkdb-${i}.sqlite.db-wal`); } catch {}
    try { unlinkSync(`/tmp/test-linkdb-${i}.sqlite.db-shm`); } catch {}
  }
});

describe("LinkDb", () => {
  test("append and load single entry", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/Page", "text/html");
    expect(db.size()).toBe(1);
    expect(db.visitedSet().size).toBe(0);
    db.close();
  });

  test("append multiple entries", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/A", "text/html");
    db.append("https://site.com/wiki/B", "text/html");
    db.append("https://site.com/img.jpg", "image/jpeg");
    expect(db.size()).toBe(3);
    db.close();
  });

  test("append dedup — same URL INSERT OR IGNORE", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/Dedup", "text/html");
    db.append("https://site.com/wiki/Dedup", "text/html");
    expect(db.size()).toBe(1);
    db.close();
  });

  test("mark visited updates in place", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/V", "text/html");
    db.markVisited("https://site.com/wiki/V");
    expect(db.visitedSet().has("https://site.com/wiki/V")).toBe(true);

    // Re-open and verify persistence
    db.close();
    const db2 = new LinkDb(p);
    expect(db2.visitedSet().has("https://site.com/wiki/V")).toBe(true);
    db2.close();
  });

  test("mark processed updates in place", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/P", "text/html");
    db.markVisited("https://site.com/wiki/P");
    db.markProcessed("https://site.com/wiki/P");
    expect(db.processedSet().has("https://site.com/wiki/P")).toBe(true);

    db.close();
    const db2 = new LinkDb(p);
    expect(db2.processedSet().has("https://site.com/wiki/P")).toBe(true);
    db2.close();
  });

  test("unprocessedVisited returns queue for resume", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/Done", "text/html");
    db.markVisited("https://site.com/wiki/Done");
    db.markProcessed("https://site.com/wiki/Done");

    db.append("https://site.com/wiki/Unprocessed", "text/html");
    db.markVisited("https://site.com/wiki/Unprocessed");

    db.append("https://site.com/wiki/NotVisited", "text/html");

    const queue = db.unprocessedVisited();
    expect(queue).toEqual(["https://site.com/wiki/Unprocessed"]);
    db.close();
  });

  test("visitedSet and processedSet", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/A", "text/html");
    db.markVisited("https://site.com/wiki/A");
    db.markProcessed("https://site.com/wiki/A");

    db.append("https://site.com/wiki/B", "text/html");
    db.markVisited("https://site.com/wiki/B");

    expect(db.visitedSet().size).toBe(2);
    expect(db.processedSet().size).toBe(1);
    db.close();
  });

  test("URLs with special characters", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    const url = "https://site.com/wiki/Page?q=a&b=c#frag";
    db.append(url, "text/html");
    db.markVisited(url);
    expect(db.visitedSet().has(url)).toBe(true);
    db.close();
  });

  test("empty database loads cleanly", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    expect(db.size()).toBe(0);
    expect(db.visitedSet().size).toBe(0);
    expect(db.processedSet().size).toBe(0);
    expect(db.unprocessedVisited().length).toBe(0);
    db.close();
  });

  test("mark on unknown URL is no-op (no crash)", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.markVisited("https://site.com/unknown");
    db.markProcessed("https://site.com/unknown");
    expect(db.size()).toBe(0);
    db.close();
  });

  test("markVisited updates content type", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/page", "text/html");
    db.markVisited("https://site.com/page", "text/html; charset=utf-8");
    db.close();

    // Verify via export
    const sqlPath = p.replace(".sqlite.db", ".sql");
    const db2 = new LinkDb(p);
    db2.exportSql(sqlPath);
    const dump = readFileSync(sqlPath, "utf-8");
    expect(dump).toContain("text/html; charset=utf-8");
    expect(dump).toContain("',1,0);");
    unlinkSync(sqlPath);
    db2.close();
  });

  test("exportSql generates valid SQL", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append("https://site.com/wiki/A", "text/html");
    db.markVisited("https://site.com/wiki/A");
    db.markProcessed("https://site.com/wiki/A");

    db.append("https://site.com/wiki/B", "text/html");
    db.markVisited("https://site.com/wiki/B");

    const sqlPath = p.replace(".sqlite.db", ".sql");
    db.exportSql(sqlPath);
    const dump = readFileSync(sqlPath, "utf-8");
    expect(dump).toContain("sitemap exported");
    expect(dump).toContain("https://site.com/wiki/A");
    expect(dump).toContain("https://site.com/wiki/B");
    expect(dump).toContain("',1,1);");
    expect(dump).toContain("',1,0);");
    unlinkSync(sqlPath);
    db.close();
  });

  test("exportSql escapes single quotes in URLs", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    const url = "https://site.com/wiki/O'Brien";
    db.append(url, "text/html");
    db.markVisited(url);

    const sqlPath = p.replace(".sqlite.db", ".sql");
    db.exportSql(sqlPath);
    const dump = readFileSync(sqlPath, "utf-8");
    expect(dump).toContain("O''Brien");
    unlinkSync(sqlPath);
    db.close();
  });
});
