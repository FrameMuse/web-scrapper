#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { fetchHtml, setChromeEnabled, getChromeSession } from "../lib/fetchHtml.ts";
import { extract } from "../lib/extract.ts";
import { renderFrontmatter } from "../lib/frontmatter.ts";
import { rewriteLinks } from "../lib/linkRewrite.ts";
import { mdPath, writeFile } from "../lib/save.ts";
import {
  loadLinkMap,
  saveLinkMap,
  addToMap,
  markVisited,
  markProcessed,
} from "../lib/linkMap.ts";
import {
  fetchSitemap,
  loadCachedSitemap,
  saveSitemapCache,
  diffUrls,
  findMissingFiles,
} from "../lib/sitemap.ts";

const CONVERTER =
  import.meta.dirname + "/../rust-converter/target/release/html-to-md";

// ---- arg parsing ----

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | string[] | number | boolean> = {};
  const positional: string[] = [];
  let hasFlags = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      hasFlags = true;
      const eq = a.indexOf("=");
      let key: string, val: string;
      if (eq !== -1) {
        key = a.substring(2, eq);
        val = a.substring(eq + 1);
      } else {
        key = a.substring(2);
        val = "true";
      }

      // Repeatable flags
      if (key === "selector" || key === "code-by" || key === "exclude") {
        const map: Record<string, string> = { "code-by": "codeBy", exclude: "exclude" };
        const k = map[key] || "selector";
        if (!flags[k]) flags[k] = [];
        (flags[k] as string[]).push(val);
      } else if (key === "concurrent" || key === "interval" || key === "offset" || key === "limit") {
        flags[key] = parseInt(val, 10);
      } else {
        flags[key] = val;
      }
    } else {
      positional.push(a);
    }
  }

  return { flags, positional, hasFlags };
}

const { flags, positional, hasFlags } = parseArgs();

function expandTilde(s: string): string {
  return s.startsWith("~") ? s.replace("~", process.env.HOME || "") : s;
}

const selector = (flags["selector"] as string[]) ?? [];
const codeBy = (flags["codeBy"] as string[]) ?? [];
const exclude = (flags["exclude"] as string[]) ?? [];
const matchRe = flags["match"] as string | undefined;
const urlBase = flags["url-base"] as string | undefined;
const urlFilter = (flags["url-filter"] as string) ?? urlBase;
const sitemapUrl = flags["sitemap"] as string | undefined;
const concurrent = (flags["concurrent"] as number) ?? 1;
const interval = (flags["interval"] as number) ?? 200;
const offset = (flags["offset"] as number) ?? 0;
const limit = flags["limit"] as number | undefined;
const force = flags["force"] === "true";
const dryRun = flags["dry-run"] === "true";
const followLinks = flags["follow-links"] === "true";
const useChrome = flags["chrome"] === "true";
const outputDir = expandTilde((flags["output"] as string) ?? ".");
const buildMapPath = flags["build-map"]
  ? expandTilde(flags["build-map"] as string)
  : undefined;
const singleUrl = positional[0];

if (buildMapPath && !followLinks) {
  console.error("--build-map requires --follow-links");
  process.exit(1);
}

const resolvedConcurrent = concurrent;
if (useChrome) setChromeEnabled(true, concurrent);

const pipeMode = !hasFlags && !!singleUrl;

if (hasFlags && !urlBase && !urlFilter) {
  console.error("--url-base or --url-filter is required");
  process.exit(1);
}

const resolvedBaseUrl = urlBase || urlFilter || (singleUrl ? singleUrl : "");

// ---- link filters ----

const MEDIA_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".bmp", ".ico",
  ".mp4", ".webm", ".avi", ".mov", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".pdf", ".doc", ".docx", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
];

function isMediaLink(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch { return false; }
}

function isExcluded(url: string): boolean {
  return exclude.some((p) => {
    try { return new RegExp(p).test(url); } catch { return false; }
  });
}

const mimeCache = new Map<string, boolean>();

async function isMediaMime(url: string): Promise<boolean> {
  if (mimeCache.has(url)) return mimeCache.get(url)!;
  try {
    const res = await fetch(url, { method: "HEAD" });
    const ct = res.headers.get("content-type") || "";
    const result = /^(image|video|audio)\//i.test(ct);
    mimeCache.set(url, result);
    return result;
  } catch {
    mimeCache.set(url, false);
    return false;
  }
}

// ---- helpers ----

async function htmlToMd(html: string): Promise<string> {
  const converterArgs = codeBy.length > 0 ? codeBy : [];
  const proc = spawnSync(CONVERTER, converterArgs, { input: html, encoding: "utf-8" });
  if (proc.error) throw new Error(`Converter failed: ${proc.error.message}`);
  const out = (proc.stdout ?? "").trimEnd();
  if (proc.status !== 0)
    throw new Error(`Converter exit code ${proc.status}: ${proc.stderr}`);
  return out;
}

async function scrapeOne(url: string): Promise<void> {
  const { html } = await fetchHtml(url);
  const extracted = extract(html, selector, matchRe);
  if (!extracted) {
    console.error(`  No content found at ${url}`);
    return;
  }

  let mdBody = await htmlToMd(extracted.contentHtml);
  // Strip Docusaurus-style hash-link anchors
  mdBody = mdBody.replace(/\s*\[​\]\(#[^)]+\)/g, "");
  // Fix unnecessary hyphen escaping
  mdBody = mdBody.replace(/\\-/g, "-");

  const rewritten = rewriteLinks(mdBody, url, resolvedBaseUrl);
  const fm = renderFrontmatter({
    title: extracted.title,
    description: extracted.description,
    source: url,
    date: extracted.date,
  });

  const output = fm + "\n" + rewritten + "\n";

  if (pipeMode) {
    process.stdout.write(output);
  } else {
    const outPath = mdPath(outputDir, url, resolvedBaseUrl);
    writeFile(outPath, output);
    const rel = outPath.replace(outputDir + "/", "");
    console.error(`  \u2713 ${rel}`);
  }
}

function filterUrls(urls: string[]): string[] {
  let filtered = urlFilter
    ? urls.filter((u) => u.startsWith(urlFilter!))
    : urls;
  // Filter out pagination
  filtered = filtered.filter((u) => !/\/page\/\d+\/$/.test(u));
  // Apply offset/limit
  if (offset > 0) filtered = filtered.slice(offset);
  if (limit !== undefined) filtered = filtered.slice(0, limit);
  return filtered;
}

async function batchProcess(urls: string[]): Promise<void> {
  console.error(`Scraping ${urls.length} pages...`);

  for (let i = 0; i < urls.length; i += resolvedConcurrent) {
    const batch = urls.slice(i, i + resolvedConcurrent);
    const labels = batch.map(
      (u) => `[${i + batch.indexOf(u) + 1}/${urls.length}]`
    );

    await Promise.allSettled(
      batch.map(async (url, idx) => {
        process.stderr.write(`${labels[idx]} `);
        try {
          await scrapeOne(url);
        } catch (e: any) {
          console.error(`  \u2717 ${url}: ${e.message}`);
        }
      })
    );

    if (i + resolvedConcurrent < urls.length) {
      await Bun.sleep(interval);
    }
  }

  console.error(`Done. ${urls.length} pages scraped.`);
}

async function batchFromSitemap(): Promise<void> {
  // Fetch fresh sitemap
  const fresh = await fetchSitemap(sitemapUrl!);
  let urls = filterUrls(fresh.urls);

  if (dryRun) {
    for (const u of urls) console.log(u);
    return;
  }

  // Ensure output dir exists
  writeFile(outputDir + "/.keep", "");

  // Check cache
  const cached = loadCachedSitemap(outputDir);

  if (!force && cached) {
    const sitemapsDiffer = cached.xml !== fresh.xml;

    if (sitemapsDiffer) {
      // Sitemap changed — scrape new URLs only
      const newUrls = diffUrls(
        filterUrls(fresh.urls),
        filterUrls(cached.urls)
      );
      if (newUrls.length === 0) {
        console.error("No new URLs found. To re-scrape all, use --force.");
        return;
      }
      saveSitemapCache(outputDir, fresh.xml);
      urls = newUrls;
      console.error(`Sitemap changed. ${newUrls.length} new pages.`);
    } else {
      // Sitemap same — check for missing files
      const missing = findMissingFiles(outputDir, urls, resolvedBaseUrl);
      if (missing.length === 0) {
        console.error(
          "Up-to-date. To re-scrape all, use --force."
        );
        return;
      }
      urls = missing;
      console.error(`${missing.length} files missing. Scraping...`);
    }
  } else {
    // First run or --force
    saveSitemapCache(outputDir, fresh.xml);
  }

  await batchProcess(urls);
}

async function singlePage(): Promise<void> {
  if (dryRun) {
    console.log(singleUrl);
    return;
  }
  if (!pipeMode) writeFile(outputDir + "/.keep", "");
  await scrapeOne(singleUrl!);
}

function normalizeUrl(u: string): string {
  // Strip hash
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.substring(0, hashIdx);
  return u.replace(/\/+$/, "") + "/";
}

function extractAllRawLinks(html: string, baseUrl: string): string[] {
  const raw: string[] = [];
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], baseUrl).href;
      const normalized = normalizeUrl(resolved);
      if (!urlFilter || normalized.startsWith(normalizeUrl(urlFilter))) {
        raw.push(normalized);
      }
    } catch {}
  }

  // Deduplicate
  const seen = new Set<string>();
  return raw.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

async function extractLinks(html: string, baseUrl: string): Promise<Array<{ original: string; normalized: string }>> {
  const candidates = extractAllRawLinks(html, baseUrl).map((normalized) => ({
    normalized,
    // Re-derive original for link queue (use normalized as original lookup)
    original: normalized,
  }));

  // Extension filter (fast, no network)
  const result: Array<{ original: string; normalized: string }> = [];
  const mimeCheck: Array<{ original: string; normalized: string }> = [];
  for (const link of candidates) {
    if (isMediaLink(link.original) || isExcluded(link.original)) continue;
    mimeCheck.push(link);
  }

  // MIME check (network, lazy)
  for (const link of mimeCheck) {
    if (!(await isMediaMime(link.original))) {
      result.push(link);
    }
  }

  return result;
}

async function crawlLinks(): Promise<void> {
  if (!singleUrl) {
    console.error("--follow-links requires a starting URL");
    process.exit(1);
  }
  if (pipeMode) {
    console.error("--follow-links requires --output for batch mode");
    process.exit(1);
  }

  writeFile(outputDir + "/.keep", "");
  const startNormalized = normalizeUrl(singleUrl!);
  const processed = new Set<string>();
  const visited = new Set<string>([startNormalized]);
  const queue: Array<{ original: string }> = [{ original: singleUrl! }];
  const map = buildMapPath ? loadLinkMap(buildMapPath) : null;

  while (queue.length > 0 && (limit === undefined || processed.size < limit)) {
    const batch = queue.splice(
      0,
      Math.min(resolvedConcurrent, limit !== undefined ? limit - processed.size : resolvedConcurrent)
    );

    const results = await Promise.allSettled(
      batch.map(async ({ original: url }) => {
        if (processed.has(url)) return;
        processed.add(url);

        const { html, contentType } = await fetchHtml(url);
        if (map) markVisited(map, url, contentType);

        // Track all discovered links (before filtering)
        const allLinks = extractAllRawLinks(html, url);
        if (map) addToMap(map, allLinks);

        // Discover new crawlable links (filtered)
        const discovered = await extractLinks(html, url);
        for (const { original: linkUrl, normalized } of discovered) {
          if (!visited.has(normalized)) {
            visited.add(normalized);
            if (limit === undefined || processed.size + queue.length < limit) {
              queue.push({ original: linkUrl });
            }
          }
        }

        // Scrape content
        const extracted = extract(html, selector, matchRe);
        if (!extracted) {
          console.error(`  No content found at ${url}`);
          return;
        }

        let mdBody = await htmlToMd(extracted.contentHtml);
        mdBody = mdBody.replace(/\s*\[​\]\(#[^)]+\)/g, "");
        mdBody = mdBody.replace(/\\-/g, "-");
        const rewritten = rewriteLinks(mdBody, url, resolvedBaseUrl);
        const fm = renderFrontmatter({
          title: extracted.title,
          description: extracted.description,
          source: url,
          date: extracted.date,
        });
        const outPath = mdPath(outputDir, url, resolvedBaseUrl);
        writeFile(outPath, fm + "\n" + rewritten + "\n");
        if (map) markProcessed(map, url);
        const rel = outPath.replace(outputDir + "/", "");
        console.error(`  \u2713 ${rel}`);
      })
    );

    for (const r of results) {
      if (r.status === "rejected") {
        console.error(`  \u2717 ${r.reason}`);
      }
    }

    // Save map after each batch
    if (map) saveLinkMap(buildMapPath!, map);

    if (queue.length > 0) {
      await Bun.sleep(interval);
    }
  }

  console.error(`Done. ${processed.size} pages scraped.`);
}

// ---- main ----

try {
  if (followLinks) {
    await crawlLinks();
  } else if (sitemapUrl) {
    if (pipeMode) {
      console.error("--sitemap requires --output for batch mode");
      process.exit(1);
    }
    await batchFromSitemap();
  } else if (singleUrl) {
    await singlePage();
  } else if (dryRun) {
    console.error("--dry-run requires --sitemap, --follow-links, or a URL argument");
    process.exit(1);
  } else {
    console.error("Usage:");
    console.error("  scrape <url>                                               # pipe mode: stdout + auto-detect selectors");
    console.error("  scrape --selector=... <url>                                 # file mode: write .md, auto output dir");
    console.error("  scrape --selector=... --url-base=... <url>                  # file mode with link rewriting");
    console.error("  scrape --sitemap=URL --selector=... --url-base=... --output=DIR  # batch from sitemap");
    console.error("  scrape <url> --follow-links --url-base=... --output=DIR      # batch from link crawling");
    process.exit(1);
  }
} finally {
  getChromeSession()?.close();
}
