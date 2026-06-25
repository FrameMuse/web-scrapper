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
    try { unlinkSync(`/tmp/test-linkdb-${i}.json`); } catch {}
  }
});

describe("LinkDb", () => {
  test("append and load single entry", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/Page", ct: "text/html"}]);
    expect(db.size()).toBe(1);
    expect(db.visitedSet().size).toBe(0);
    db.close();
  });

  test("append multiple entries", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/A", ct: "text/html"}]);
    db.append([{url: "https://site.com/wiki/B", ct: "text/html"}]);
    db.append([{url: "https://site.com/img.jpg", ct: "image/jpeg"}]);
    expect(db.size()).toBe(3);
    db.close();
  });

  test("append dedup — same URL INSERT OR IGNORE", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/Dedup", ct: "text/html"}]);
    db.append([{url: "https://site.com/wiki/Dedup", ct: "text/html"}]);
    expect(db.size()).toBe(1);
    db.close();
  });

  test("mark visited updates in place", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/V", ct: "text/html"}]);
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
    db.append([{url: "https://site.com/wiki/P", ct: "text/html"}]);
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
    db.append([{url: "https://site.com/wiki/Done", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Done");
    db.markProcessed("https://site.com/wiki/Done");

    db.append([{url: "https://site.com/wiki/Unprocessed", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Unprocessed");

    db.append([{url: "https://site.com/wiki/NotVisited", ct: "text/html"}]);

    const queue = db.unprocessedVisited();
    expect(queue).toEqual(["https://site.com/wiki/Unprocessed"]);
    db.close();
  });

  test("visitedSet and processedSet", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/A", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/A");
    db.markProcessed("https://site.com/wiki/A");

    db.append([{url: "https://site.com/wiki/B", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/B");

    expect(db.visitedSet().size).toBe(2);
    expect(db.processedSet().size).toBe(1);
    db.close();
  });

  test("URLs with special characters", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    const url = "https://site.com/wiki/Page?q=a&b=c#frag";
    db.append([{url, ct: "text/html"}]);
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
    db.append([{url: "https://site.com/page", ct: "text/html"}]);
    db.markVisited("https://site.com/page", "text/html; charset=utf-8");
    db.close();

    // Verify via export
    const jsonPath = p.replace(".sqlite.db", ".json");
    const db2 = new LinkDb(p);
    db2.exportJson(jsonPath, "https://site.com/");
    const dump = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(dump.entries[0][1]).toBe("text/html; charset=utf-8");
    expect(dump.entries[0][2]).toBe(1); // visited
    unlinkSync(jsonPath);
    db2.close();
  });

  test("exportJson generates valid JSON", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/A", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/A");
    db.markProcessed("https://site.com/wiki/A");

    db.append([{url: "https://site.com/wiki/B", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/B");

    const jsonPath = p.replace(".sqlite.db", ".json");
    db.exportJson(jsonPath, "https://site.com/wiki/");
    const dump = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(dump.urlBase).toBe("https://site.com/wiki/");
    expect(dump.entries.length).toBe(2);
    expect(dump.entries[0]).toEqual(["A", "text/html", 3]); // visited|processed = 3
    expect(dump.entries[1]).toEqual(["B", "text/html", 1]); // visited = 1
    unlinkSync(jsonPath);
    db.close();
  });

  test("exportJson strips urlBase prefix", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/img.jpg", ct: "image/jpeg"}]);
    db.markVisited("https://site.com/img.jpg");

    const jsonPath = p.replace(".sqlite.db", ".json");
    db.exportJson(jsonPath, "https://site.com/");
    const dump = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(dump.entries[0][0]).toBe("img.jpg");
    unlinkSync(jsonPath);
    db.close();
  });

  test("exportJson flags are bitwise correct", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/None", ct: "text/html"}]);
    // not visited, not processed
    db.append([{url: "https://site.com/wiki/V", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/V");
    db.append([{url: "https://site.com/wiki/P", ct: "text/html"}]);
    db.markProcessed("https://site.com/wiki/P");
    db.append([{url: "https://site.com/wiki/Both", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Both");
    db.markProcessed("https://site.com/wiki/Both");

    const jsonPath = p.replace(".sqlite.db", ".json");
    db.exportJson(jsonPath, "https://site.com/wiki/");
    const dump = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const byUri = Object.fromEntries(dump.entries.map((e: any) => [e[0], e[2]]));
    expect(byUri["None"]).toBe(0);  // none
    expect(byUri["V"]).toBe(1);     // visited
    expect(byUri["P"]).toBe(2);     // processed
    expect(byUri["Both"]).toBe(3);  // visited | processed
    unlinkSync(jsonPath);
    db.close();
  });

  test("round-trip: export → import → verify", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/A", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/A");
    db.markProcessed("https://site.com/wiki/A");

    db.append([{url: "https://site.com/wiki/B", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/B");

    db.append([{url: "https://site.com/wiki/C", ct: "text/html"}]);
    // not visited, not processed

    const jsonPath = p.replace(".sqlite.db", ".json");
    db.exportJson(jsonPath, "https://site.com/wiki/");
    db.close();

    // Import into a fresh DB
    const p2 = tmpPath();
    const db2 = new LinkDb(p2);
    db2.importJson(jsonPath);

    expect(db2.size()).toBe(3);
    expect(db2.visitedSet().has("https://site.com/wiki/A")).toBe(true);
    expect(db2.processedSet().has("https://site.com/wiki/A")).toBe(true);
    expect(db2.visitedSet().has("https://site.com/wiki/B")).toBe(true);
    expect(db2.processedSet().has("https://site.com/wiki/B")).toBe(false);
    expect(db2.visitedSet().has("https://site.com/wiki/C")).toBe(false);
    expect(db2.processedSet().has("https://site.com/wiki/C")).toBe(false);

    const queue = db2.unprocessedVisited();
    expect(queue).toEqual(["https://site.com/wiki/B"]);

    unlinkSync(jsonPath);
    db2.close();
  });

  test("round-trip: export → import resume works", () => {
    const p = tmpPath();
    const db = new LinkDb(p);
    db.append([{url: "https://site.com/wiki/Unprocessed1", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Unprocessed1");
    db.append([{url: "https://site.com/wiki/Unprocessed2", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Unprocessed2");
    db.append([{url: "https://site.com/wiki/Done", ct: "text/html"}]);
    db.markVisited("https://site.com/wiki/Done");
    db.markProcessed("https://site.com/wiki/Done");

    const jsonPath = p.replace(".sqlite.db", ".json");
    db.exportJson(jsonPath, "https://site.com/wiki/");
    db.close();

    // Import and resume
    const p2 = tmpPath();
    const db2 = new LinkDb(p2);
    db2.importJson(jsonPath);

    const queue = db2.unprocessedVisited();
    expect(queue.sort()).toEqual(["https://site.com/wiki/Unprocessed1", "https://site.com/wiki/Unprocessed2"]);

    unlinkSync(jsonPath);
    db2.close();
  });
});
