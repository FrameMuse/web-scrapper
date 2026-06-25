import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";

let _logFile: string | null = null;
let _runId = "";

function generateRunId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `${y}${m}${d}-${h}${min}${s}-${rand}`;
}

export function getRunId(): string {
  return _runId;
}

export function initLogger(outputDir: string): void {
  _runId = generateRunId();
  const runsDir = join(outputDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  _logFile = join(runsDir, `${_runId}.log`);
  log("INFO", "Run started", true);
}

export function log(level: string, message: string, skipStderr = false): void {
  const line = `[${new Date().toISOString()}] [${level}] ${_runId} ${message}`;
  if (!skipStderr) process.stderr.write(line + "\n");
  if (_logFile) {
    try { appendFileSync(_logFile, line + "\n"); } catch {}
  }
}
