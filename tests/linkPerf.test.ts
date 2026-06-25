import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync, writeFileSync, readFileSync } from "fs";
import { LinkCsv } from "../lib/linkCsv";
import { LinkDb } from "../lib/linkDb";

const CSV_PATH = "/tmp/perf-test.csv";
const JSON_PATH = "/tmp/perf-test.json";
const SQLITE_PATH = "/tmp/perf-test.sqlite.db";

function makeUrl(n: number): string {
  return `https://site.com/wiki/Page_${n}_with_a_fairly_long_path_name`;
}

function makeJsonMap(n: number): Record<string, { visited: boolean; processed: boolean; contentType: string | null; url?: string }> {
  const map: Record<string, any> = {};
  for (let i = 0; i < n; i++) {
    const url = makeUrl(i);
    map[url] = { visited: true, processed: true, contentType: "text/html" };
  }
  return map;
}

beforeAll(() => {
  try { unlinkSync(CSV_PATH); } catch {}
  try { unlinkSync(JSON_PATH); } catch {}
});

afterAll(() => {
  try { unlinkSync(CSV_PATH); } catch {}
  try { unlinkSync(JSON_PATH); } catch {}
  try { unlinkSync(SQLITE_PATH); } catch {}
  try { unlinkSync(SQLITE_PATH + "-wal"); } catch {}
  try { unlinkSync(SQLITE_PATH + "-shm"); } catch {}
});

describe("perf: CSV vs JSON", () => {
  const SIZES = [100, 1000];

  for (const N of SIZES) {
    test(`write ${N} entries — CSV`, () => {
      const csv = new LinkCsv(CSV_PATH);
      csv.load();
      const start = performance.now();
      for (let i = 0; i < N; i++) {
        csv.append(makeUrl(i), "text/html");
      }
      const elapsed = performance.now() - start;
      console.error(`  CSV write ${N}: ${elapsed.toFixed(2)}ms`);
      csv.close();
    });

    test(`write ${N} entries — JSON`, () => {
      const start = performance.now();
      const map = makeJsonMap(N);
      writeFileSync(JSON_PATH, JSON.stringify(map, null, 2));
      const elapsed = performance.now() - start;
      console.error(`  JSON write ${N}: ${elapsed.toFixed(2)}ms`);
    });

    test(`read + parse ${N} entries — CSV`, () => {
      const start = performance.now();
      const csv = new LinkCsv(CSV_PATH);
      csv.load();
      const elapsed = performance.now() - start;
      expect(csv.size()).toBe(N);
      console.error(`  CSV read ${N}: ${elapsed.toFixed(2)}ms`);
      csv.close();
    });

    test(`read + parse ${N} entries — JSON`, () => {
      const start = performance.now();
      const data = readFileSync(JSON_PATH, "utf-8");
      const map = JSON.parse(data);
      const elapsed = performance.now() - start;
      expect(Object.keys(map).length).toBe(N);
      console.error(`  JSON read ${N}: ${elapsed.toFixed(2)}ms`);
    });
  }

  test("update 1 entry in 1000 — CSV (in-place)", () => {
    const csv = new LinkCsv(CSV_PATH);
    csv.load();
    const start = performance.now();
    csv.markVisited(makeUrl(500));
    csv.markProcessed(makeUrl(500));
    const elapsed = performance.now() - start;
    console.error(`  CSV update 1 in 1000: ${elapsed.toFixed(3)}ms`);
    csv.close();
  });

  test("update 1 entry in 1000 — JSON (full rewrite)", () => {
    const data = readFileSync(JSON_PATH, "utf-8");
    const map = JSON.parse(data);
    const start = performance.now();
    map[makeUrl(500)].visited = true;
    map[makeUrl(500)].processed = true;
    writeFileSync(JSON_PATH, JSON.stringify(map, null, 2));
    const elapsed = performance.now() - start;
    console.error(`  JSON update 1 in 1000: ${elapsed.toFixed(3)}ms`);
  });

  test("append 1 entry to 1000 — CSV", () => {
    const csv = new LinkCsv(CSV_PATH);
    csv.load();
    const start = performance.now();
    csv.append(makeUrl(9999), "text/html");
    const elapsed = performance.now() - start;
    console.error(`  CSV append 1 to ${csv.size() - 1}: ${elapsed.toFixed(3)}ms`);
    csv.close();
  });

  test("append 1 entry to 1000 — JSON (full rewrite)", () => {
    const data = readFileSync(JSON_PATH, "utf-8");
    const map = JSON.parse(data);
    map[makeUrl(9999)] = { visited: false, processed: false, contentType: "text/html" };
    const start = performance.now();
    writeFileSync(JSON_PATH, JSON.stringify(map, null, 2));
    const elapsed = performance.now() - start;
    console.error(`  JSON append 1 to ${Object.keys(map).length - 1}: ${elapsed.toFixed(3)}ms`);
  });

  test("resume from 1000 entries — CSV", () => {
    const csv = new LinkCsv(CSV_PATH);
    csv.load();
    const start = performance.now();
    const queue = csv.unprocessedVisited();
    const elapsed = performance.now() - start;
    console.error(`  CSV resume from ${csv.size()}: ${elapsed.toFixed(3)}ms (${queue.length} unprocessed)`);
    csv.close();
  });

  test("resume from 1000 entries — JSON", () => {
    const start = performance.now();
    const data = readFileSync(JSON_PATH, "utf-8");
    const map = JSON.parse(data);
    const processed = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const [normUrl, entry] of Object.entries(map)) {
      if (entry.visited) visited.add(normUrl);
      if (entry.processed) processed.add(normUrl);
      if (entry.visited && !entry.processed) queue.push(normUrl);
    }
    const elapsed = performance.now() - start;
    console.error(`  JSON resume from ${Object.keys(map).length}: ${elapsed.toFixed(3)}ms (${queue.length} unprocessed)`);
  });

  test("file size CSV vs JSON vs SQLite", () => {
    const csvSize = readFileSync(CSV_PATH).length;
    const jsonSize = readFileSync(JSON_PATH).length;
    let sqliteSize = 0;
    try { sqliteSize = readFileSync(SQLITE_PATH).length; } catch {}
    console.error(`  CSV file size: ${(csvSize / 1024).toFixed(1)}KB`);
    console.error(`  JSON file size: ${(jsonSize / 1024).toFixed(1)}KB`);
    if (sqliteSize > 0) console.error(`  SQLite file size: ${(sqliteSize / 1024).toFixed(1)}KB`);
  });
});

describe("perf: SQLite", () => {
  const SIZES = [100, 1000];

  for (const N of SIZES) {
    test(`write ${N} entries`, () => {
      const db = new LinkDb(SQLITE_PATH);
      const start = performance.now();
      for (let i = 0; i < N; i++) {
        db.append(makeUrl(i), "text/html");
      }
      const elapsed = performance.now() - start;
      console.error(`  SQLite write ${N}: ${elapsed.toFixed(2)}ms`);
      db.close();
    });

    test(`read + query ${N} entries`, () => {
      const start = performance.now();
      const db = new LinkDb(SQLITE_PATH);
      // Mark all as visited so visitedSet query returns them
      for (let i = 0; i < N; i++) {
        db.markVisited(makeUrl(i));
      }
      const visited = db.visitedSet();
      const processed = db.processedSet();
      const queue = db.unprocessedVisited();
      const elapsed = performance.now() - start;
      expect(visited.size).toBe(N);
      console.error(`  SQLite read ${N}: ${elapsed.toFixed(2)}ms`);
      db.close();
    });
  }

  test("update 1 entry in 1000", () => {
    const db = new LinkDb(SQLITE_PATH);
    const url = makeUrl(500);
    db.markVisited(url);
    db.markProcessed(url);
    const start = performance.now();
    db.markVisited(url);
    db.markProcessed(url);
    const elapsed = performance.now() - start;
    console.error(`  SQLite update 1 in 1000: ${elapsed.toFixed(3)}ms`);
    db.close();
  });

  test("append 1 entry to 1000", () => {
    const db = new LinkDb(SQLITE_PATH);
    const start = performance.now();
    db.append(makeUrl(9999), "text/html");
    const elapsed = performance.now() - start;
    console.error(`  SQLite append 1 to ${db.size() - 1}: ${elapsed.toFixed(3)}ms`);
    db.close();
  });

  test("resume from 1001 entries", () => {
    const db = new LinkDb(SQLITE_PATH);
    const start = performance.now();
    const queue = db.unprocessedVisited();
    const elapsed = performance.now() - start;
    console.error(`  SQLite resume from ${db.size()}: ${elapsed.toFixed(3)}ms (${queue.length} unprocessed)`);
    db.close();
  });

  test("export to .sql", () => {
    const db = new LinkDb(SQLITE_PATH);
    const sqlPath = "/tmp/perf-export.sql";
    const start = performance.now();
    db.exportSql(sqlPath);
    const elapsed = performance.now() - start;
    const sqlSize = readFileSync(sqlPath).length;
    console.error(`  SQLite export to SQL: ${elapsed.toFixed(3)}ms (${(sqlSize / 1024).toFixed(1)}KB)`);
    unlinkSync(sqlPath);
    db.close();
  });
});
