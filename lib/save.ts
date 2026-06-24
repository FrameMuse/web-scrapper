import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export function urlToPath(url: string, urlBase: string): string {
  const basePath = new URL(urlBase).pathname.replace(/\/+$/, "/");
  const u = new URL(url);
  let path = u.pathname;
  if (path.startsWith(basePath)) {
    path = path.substring(basePath.length);
  }
  path = path.replace(/\/+$/, "");
  if (path === "") path = "index";
  if (u.search) {
    path += "_" + u.search.replace(/^\?/, "").replace(/&/g, "_");
  }
  return path;
}

export function writeFile(path: string, content: string): void {
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf-8");
}

export function mdPath(outputDir: string, url: string, urlBase: string): string {
  const rel = urlToPath(url, urlBase);
  return join(outputDir, rel + ".md");
}
