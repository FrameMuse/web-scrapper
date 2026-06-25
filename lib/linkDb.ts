import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { LinkFlags } from "./linkFlags.ts";

export class LinkDb {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA synchronous=NORMAL");
    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    const applied = new Set(
      (this.db.query("SELECT name FROM _migrations ORDER BY name").all() as { name: string }[]).map((r) => r.name),
    );

    const migrationsDir = join(import.meta.dirname!, "migrations");
    let files: string[];
    try {
      files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      return;
    }

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      this.db.run(sql);
      this.db.run("INSERT INTO _migrations (name) VALUES (?)", file);
    }
  }

  append(url: string, ct: string): void {
    this.db.run("INSERT OR IGNORE INTO links (url, ct) VALUES (?, ?)", url, ct || "");
  }

  markVisited(url: string, ct?: string): void {
    if (ct !== undefined) {
      this.db.run("UPDATE links SET visited=1, ct=? WHERE url=?", ct, url);
    } else {
      this.db.run("UPDATE links SET visited=1 WHERE url=?", url);
    }
  }

  markProcessed(url: string): void {
    this.db.run("UPDATE links SET processed=1 WHERE url=?", url);
  }

  visitedSet(): Set<string> {
    const rows = this.db.query("SELECT url FROM links WHERE visited=1").all() as { url: string }[];
    return new Set(rows.map((r) => r.url));
  }

  processedSet(): Set<string> {
    const rows = this.db.query("SELECT url FROM links WHERE processed=1").all() as { url: string }[];
    return new Set(rows.map((r) => r.url));
  }

  unprocessedVisited(): string[] {
    const rows = this.db.query(
      "SELECT url FROM links WHERE visited=1 AND processed=0 ORDER BY rowid",
    ).all() as { url: string }[];
    return rows.map((r) => r.url);
  }

  size(): number {
    const row = this.db.query("SELECT COUNT(*) as c FROM links").get() as { c: number };
    return row.c;
  }

  exportJson(outputPath: string, urlBase: string): void {
    const rows = this.db.query(
      "SELECT url, ct, visited, processed FROM links ORDER BY rowid",
    ).all() as { url: string; ct: string; visited: number; processed: number }[];

    const entries: [string, string, number][] = rows.map((r) => {
      let uri = r.url;
      if (urlBase && uri.startsWith(urlBase)) uri = uri.slice(urlBase.length);
      const flags: number =
        (r.visited ? LinkFlags.Visited : LinkFlags.None) | (r.processed ? LinkFlags.Processed : LinkFlags.None);
      return [uri, r.ct, flags];
    });

    writeFileSync(outputPath, JSON.stringify({ urlBase, entries }));
  }

  importJson(inputPath: string): void {
    const data = JSON.parse(readFileSync(inputPath, "utf-8"));
    const urlBase: string = data.urlBase || "";
    const entries: [string, string, number][] = data.entries || [];

    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO links (url, ct, visited, processed) VALUES (?, ?, ?, ?)",
    );

    const tx = this.db.transaction(() => {
      for (const [uri, ct, flags] of entries) {
        const url = urlBase ? urlBase + uri : uri;
        const visited = flags & LinkFlags.Visited ? 1 : 0;
        const processed = flags & LinkFlags.Processed ? 1 : 0;
        insert.run(url, ct, visited, processed);
      }
    });

    tx();
  }

  appendLog(runId: string, level: string, message: string): void {
    this.db.run("INSERT INTO logs (run_id, level, message) VALUES (?, ?, ?)", runId, level, message);
  }

  getLogs(runId?: string, level?: string, limit = 100): { run_id: string; level: string; message: string; created_at: string }[] {
    let sql = "SELECT run_id, level, message, created_at FROM logs WHERE 1=1";
    const params: any[] = [];
    if (runId) { sql += " AND run_id=?"; params.push(runId); }
    if (level) { sql += " AND level=?"; params.push(level); }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    return this.db.query(sql).all(...params) as any[];
  }

  close(): void {
    this.db.close();
  }
}
