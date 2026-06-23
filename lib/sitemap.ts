import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fetchHtml } from "./fetchHtml";

export async function fetchSitemap(
  url: string
): Promise<{ xml: string; urls: string[] }> {
  const xml = await fetchHtml(url);
  const locs = xml.match(/<loc>([^<]+)<\/loc>/g);
  if (!locs) throw new Error("No <loc> entries found in sitemap");
  const urls = locs.map((l) => l.replace(/<\/?loc>/g, ""));
  return { xml, urls };
}

export function cachedSitemapPath(outputDir: string): string {
  return join(outputDir, "sitemap.xml");
}

export function loadCachedSitemap(outputDir: string): {
  xml: string;
  urls: string[];
} | null {
  const path = cachedSitemapPath(outputDir);
  if (!existsSync(path)) return null;
  const xml = readFileSync(path, "utf-8");
  const locs = xml.match(/<loc>([^<]+)<\/loc>/g);
  const urls = locs
    ? locs.map((l) => l.replace(/<\/?loc>/g, ""))
    : [];
  return { xml, urls };
}

export function saveSitemapCache(outputDir: string, xml: string): void {
  writeFileSync(cachedSitemapPath(outputDir), xml, "utf-8");
}

/** Return URLs from newUrls that are not in cachedUrls */
export function diffUrls(
  newUrls: string[],
  cachedUrls: string[]
): string[] {
  const cached = new Set(cachedUrls);
  return newUrls.filter((u) => !cached.has(u));
}

/** Return URLs whose .md file does not exist on disk */
export function findMissingFiles(
  outputDir: string,
  urls: string[],
  urlBase: string
): string[] {
  const { urlToPath } = require("./save");
  return urls.filter((u) => {
    const rel = urlToPath(u, urlBase);
    return !existsSync(join(outputDir, rel + ".md"));
  });
}
