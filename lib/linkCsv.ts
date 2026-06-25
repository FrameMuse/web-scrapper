import { openSync, closeSync, readFileSync, writeFileSync, writeSync, fstatSync, existsSync } from "fs";

const LINE_LENGTH = 1024;

function formatLine(url: string, ct: string, visited: string, processed: string): Buffer {
  const core = `${url}|${ct}|${visited}|${processed}`;
  const buf = Buffer.alloc(LINE_LENGTH);
  buf.write(core, 0, "utf-8");
  buf[LINE_LENGTH - 1] = 0x0A;
  return buf;
}

function parseLine(
  buf: Buffer,
): { url: string; ct: string | null; visited: boolean; processed: boolean } | null {
  const str = buf.toString("utf-8").replace(/\0/g, "").trimEnd();
  if (str.length === 0) return null;
  const parts = str.split("|");
  if (parts.length !== 4) return null;
  const url = parts[0].trimEnd();
  if (!url) return null;
  return {
    url,
    ct: parts[1].trimEnd() || null,
    visited: parts[2].trim() === "1",
    processed: parts[3].trim() === "1",
  };
}

export class LinkCsv {
  private path: string;
  private fd: number;

  urlToLine: Map<string, number> = new Map();
  private lineVisited: boolean[] = [];
  private lineProcessed: boolean[] = [];
  private lineCt: (string | null)[] = [];

  constructor(path: string) {
    this.path = path;
    if (!existsSync(path)) {
      writeFileSync(path, "");
    }
    this.fd = openSync(path, "r+");
  }

  load(): void {
    const buf = readFileSync(this.path);
    const lineCount = Math.floor(buf.length / LINE_LENGTH);

    this.urlToLine.clear();
    this.lineVisited = [];
    this.lineProcessed = [];
    this.lineCt = [];
    this.urlToCt = new Map();

    for (let i = 0; i < lineCount; i++) {
      const start = i * LINE_LENGTH;
      const chunk = buf.subarray(start, start + LINE_LENGTH);
      const parsed = parseLine(chunk);
      if (!parsed) continue;
      this.urlToLine.set(parsed.url, i);
      this.lineVisited[i] = parsed.visited;
      this.lineProcessed[i] = parsed.processed;
      this.lineCt[i] = parsed.ct;
      this.urlToCt.set(parsed.url, parsed.ct);
    }
  }

  append(url: string, contentType: string): void {
    if (this.urlToLine.has(url)) return;

    const lineIndex = Math.floor(fstatSync(this.fd).size / LINE_LENGTH);
    const line = formatLine(url, contentType || "", "0", "0");
    writeSync(this.fd, line, 0, LINE_LENGTH, lineIndex * LINE_LENGTH);

    this.urlToLine.set(url, lineIndex);
    this.lineVisited[lineIndex] = false;
    this.lineProcessed[lineIndex] = false;
    this.lineCt[lineIndex] = contentType || null;
    this.urlToCt.set(url, contentType || null);
  }

  markVisited(url: string, contentType?: string): void {
    const lineIndex = this.urlToLine.get(url);
    if (lineIndex === undefined) return;

    this.lineVisited[lineIndex] = true;
    if (contentType !== undefined) {
      this.lineCt[lineIndex] = contentType;
      this.urlToCt.set(url, contentType);
    }

    const ct = this.lineCt[lineIndex] || "";
    const line = formatLine(url, ct, "1", this.lineProcessed[lineIndex] ? "1" : "0");
    writeSync(this.fd, line, 0, LINE_LENGTH, lineIndex * LINE_LENGTH);
  }

  markProcessed(url: string): void {
    const lineIndex = this.urlToLine.get(url);
    if (lineIndex === undefined) return;

    this.lineProcessed[lineIndex] = true;

    const ct = this.lineCt[lineIndex] || "";
    const line = formatLine(url, ct, this.lineVisited[lineIndex] ? "1" : "0", "1");
    writeSync(this.fd, line, 0, LINE_LENGTH, lineIndex * LINE_LENGTH);
  }

  urlToCt: Map<string, string | null> = new Map();

  close(): void {
    if (this.fd >= 0) {
      closeSync(this.fd);
      this.fd = -1;
    }
  }

  visitedSet(): Set<string> {
    const s = new Set<string>();
    for (const [url, lineIndex] of this.urlToLine) {
      if (this.lineVisited[lineIndex]) s.add(url);
    }
    return s;
  }

  processedSet(): Set<string> {
    const s = new Set<string>();
    for (const [url, lineIndex] of this.urlToLine) {
      if (this.lineProcessed[lineIndex]) s.add(url);
    }
    return s;
  }

  unprocessedVisited(): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    // Walk in insertion order (approximated by iterating urlToLine)
    for (const [url, lineIndex] of this.urlToLine) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (this.lineVisited[lineIndex] && !this.lineProcessed[lineIndex]) {
        result.push(url);
      }
    }
    return result;
  }

  size(): number {
    return this.urlToLine.size;
  }
}
