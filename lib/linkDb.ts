import { Database } from "bun:sqlite";
import { writeFileSync, existsSync, readFileSync } from "fs";

export class LinkDb {
  private db: Database;
  private dbPath: string;

  constructor(path: string) {
    this.dbPath = path;
    this.db = new Database(path);
    this.db.run(`CREATE TABLE IF NOT EXISTS links (
      url TEXT PRIMARY KEY,
      ct TEXT NOT NULL DEFAULT '',
      visited INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0
    )`);
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA synchronous=NORMAL");
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

  exportSql(outputPath: string): void {
    const rows = this.db.query(
      "SELECT url, ct, visited, processed FROM links ORDER BY rowid",
    ).all() as { url: string; ct: string; visited: number; processed: number }[];

    const lines: string[] = [
      "-- sitemap exported from scrape crawl",
      `-- generated: ${new Date().toISOString()}`,
      `-- total urls: ${rows.length}`,
      "",
      "CREATE TABLE IF NOT EXISTS links (",
      "  url TEXT PRIMARY KEY,",
      "  ct TEXT NOT NULL DEFAULT '',",
      "  visited INTEGER NOT NULL DEFAULT 0,",
      "  processed INTEGER NOT NULL DEFAULT 0",
      ");",
      "",
    ];

    for (const r of rows) {
      const escapedUrl = r.url.replace(/'/g, "''");
      lines.push(
        `INSERT OR REPLACE INTO links (url, ct, visited, processed) VALUES ('${escapedUrl}','${r.ct}',${r.visited},${r.processed});`,
      );
    }

    lines.push("");
    writeFileSync(outputPath, lines.join("\n"));
  }

  close(): void {
    this.db.close();
  }
}
