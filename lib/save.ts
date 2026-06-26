import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export function urlToPath(url: string, urlBase: string): string {
  // Ensure base path always ends with a slash for consistent matching
  const basePath = new URL(urlBase).pathname.replace(/\/*$/, "/");
  
  const u = new URL(url);
  // Ensure incoming path also has a trailing slash temporarily for the prefix check
  let path = u.pathname.replace(/\/*$/, "/");
  let search = u.search

  if (path.startsWith(basePath)) {
    path = path.substring(basePath.length);
  }

  // Clean up leading/trailing slashes for the remaining relative path
  path = path.replace(/^\/+|\/+$/g, "");

  // If it's empty, default to index
  if (path === "") {
    path = "index";
  }

  // Handle query parameters safely
  if (search) {
    const sanitizedSearch = search
      // 1. Remove the leading '?'
      .replace(/^\?/, "")
      // 2. Replace common separators (=, &, ?) with underscores
      .replace(/[&]/g, "+")
      // 3. Sanitize any remaining non-alphanumeric/safe characters to protect the OS
      .replace(/[^a-zA-Z0-9_\-+=.]/g, "-"); // Replaces chars like *, /, %, etc. with a dash

    path += "_" + sanitizedSearch;
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
