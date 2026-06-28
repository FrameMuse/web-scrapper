#!/usr/bin/env bun
import { join } from "path";
import { HtmlToMd, HOIST_IMAGES, HOIST_LINKS } from "html2md-js";
import { DOMParser } from "linkedom";
import { extract } from "../lib/extract.ts";
import { fetchHtml, getChromeSession, setChromeEnabled } from "../lib/fetchHtml.ts";
import { renderFrontmatter } from "../lib/frontmatter.ts";
import { LinkDb } from "../lib/linkDb.ts";
import { rewriteLinks } from "../lib/linkRewrite.ts";
import {
  extractAllRawLinks,
  hasMediaExtension,
  normalizeUrl
} from "../lib/links.ts";
import { initLogger, log, setLoggerDb } from "../lib/runLogger.ts";
import { mdPath, writeFile } from "../lib/save.ts";
import {
  ImageDownloader,
  preprocessImages,
  rewriteMarkdownImages,
} from "../lib/saveImages.ts";
import {
  diffUrls,
  fetchSitemap,
  findMissingFiles,
  loadCachedSitemap,
  saveSitemapCache,
} from "../lib/sitemap.ts";

// ---- global map save for exit handlers ----
let _pendingMapSave: (() => void) | null = null;

function registerMapSave(fn: () => void): void {
  _pendingMapSave = fn;
}

process.on("exit", () => { process.stderr.write("\n"); _pendingMapSave?.(); });
process.on("SIGINT", () => { process.stderr.write("\n"); _pendingMapSave?.(); process.exit(130); });
process.on("SIGTERM", () => { process.stderr.write("\n"); _pendingMapSave?.(); process.exit(143); });

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
      if (key === "selector" || key === "code-by" || key === "exclude" || key === "visit-only" || key === "include") {
        const map: Record<string, string> = { "code-by": "codeBy", exclude: "exclude" };
        const k = map[key] ?? key;
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
const hoistImages = flags["hoist-images"] === "true";
const hoistLinks = flags["hoist-links"] === "true";
const converter = new HtmlToMd({
  codeBy,
  flags: (hoistImages ? HOIST_IMAGES : 0) | (hoistLinks ? HOIST_LINKS : 0),
});
const exclude = ((flags["exclude"] as string[]) ?? []).map(p => new RegExp(p))
const visitOnly = ((flags["visit-only"] as string[]) ?? []).map(p => new RegExp(p))
const include = ((flags["include"] as string[]) ?? []).map(p => new RegExp(p))
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
const buildMap = flags["build-map"] === "true";
const buildMapPath = buildMap ? join(outputDir, "sitemap.sqlite.db") : undefined;
const skipQuery = flags["skip-query"] === "true";
const saveImages = flags["save-images"] === "true";
const noJs = flags["no-js"] === "true";
const singleUrl = positional[0];
const resolvedBaseUrl = urlBase || urlFilter || (singleUrl ? singleUrl : "");

        if (buildMap && !followLinks) {
  log("ERROR", "--build-map requires --follow-links");
  process.exit(1);
}

const resolvedConcurrent = concurrent;
initLogger(outputDir);
log("INFO", `outputDir=${outputDir} resolvedBaseUrl=${resolvedBaseUrl}`);

if (useChrome) setChromeEnabled(true, concurrent, noJs);

const imageDownloader = saveImages ? new ImageDownloader(outputDir, resolvedBaseUrl) : null;
if (imageDownloader) {
  imageDownloader.start();
}

const pipeMode = !hasFlags && !!singleUrl;

if (hasFlags && !urlBase && !urlFilter) {
  console.error("--url-base or --url-filter is required");
  process.exit(1);
}

// ---- link filters ----

function isExcluded(url: string): boolean {
  if (visitOnly.some(p => p.test(url))) return false;
  if (include.length > 0 && !include.some(p => p.test(url))) return true;
  return exclude.some(p => p.test(url));
}

function isVisitOnly(url: string): boolean {
  return visitOnly.some(p => p.test(url));
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
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return converter.convert(doc.documentElement).trimEnd();
}

function resolveAbsolute(href: string, base: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

function stripFilteredLinks(html: string, baseUrl: string): string {
  return html.replace(
    /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>\s*/gi,
    (_, dq, sq, text) => {
      const resolved = resolveAbsolute(dq ?? sq, baseUrl);
      if (isExcluded(resolved)) return '';
      if (isVisitOnly(resolved)) return text;
      if (urlFilter && !normalizeUrl(resolved).startsWith(normalizeUrl(urlFilter))) return '';
      return _;
    },
  );
}

async function scrapeOne(url: string): Promise<void> {
  const { html, finalUrl } = await fetchHtml(url);
  if (finalUrl && finalUrl !== url) {
    if (isExcluded(finalUrl)) {
      return;
    }
    if (urlFilter && !normalizeUrl(finalUrl).startsWith(normalizeUrl(urlFilter))) {
      return;
    }
  }
  if (isVisitOnly(url)) {
    log("INFO", `Visit-only: ${url}`);
    return;
  }

  const extracted = extract(html, selector, matchRe);
  if (!extracted) {
    console.error(`  No content found at ${url}`);
    return;
  }

  let contentHtml = extracted.contentHtml;
  // Preprocess images before HTML-to-MD conversion
  if (imageDownloader) {
    contentHtml = await preprocessImages(contentHtml, url, outputDir, (imgUrl, w, h) => {
      imageDownloader.enqueue(imgUrl, w, h);
    });
  }

  // Strip excluded links from HTML before conversion
  contentHtml = stripFilteredLinks(contentHtml, url);

  let mdBody = await htmlToMd(contentHtml);
  // Strip Docusaurus-style hash-link anchors
  mdBody = mdBody.replace(/\s*\[​\]\(#[^)]+\)/g, "");
  // Fix unnecessary hyphen escaping
  mdBody = mdBody.replace(/\\-/g, "-");

  let rewritten = rewriteLinks(mdBody, url, resolvedBaseUrl);
  // Rewrite image URLs in markdown to local paths
  if (imageDownloader) {
    rewritten = rewriteMarkdownImages(rewritten, outputDir);
  }

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

async function extractLinks(html: string, baseUrl: string): Promise<Array<{ original: string; normalized: string }>> {
  const candidates = extractAllRawLinks(html, baseUrl, urlFilter, skipQuery);

  // Extension filter (fast, no network)
  const result: Array<{ original: string; normalized: string }> = [];
  const mimeCheck: Array<{ original: string; normalized: string }> = [];
  for (const link of candidates) {
    if (hasMediaExtension(link.original) || isExcluded(link.original)) continue;
    mimeCheck.push(link);
  }

  // MIME check (network, lazy) — parallel
  const mimeResults = await Promise.all(
    mimeCheck.map(async (link) => ({
      link,
      isMedia: await isMediaMime(link.original),
    }))
  );
  for (const { link, isMedia } of mimeResults) {
    if (!isMedia) result.push(link);
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
  const startUrl = skipQuery ? singleUrl!.replace(/\?.*$/, "") : singleUrl!;
  const startNormalized = normalizeUrl(startUrl);
  const processed = new Set<string>();
  const visited = new Set<string>();
  // Use normalized URL for map consistency — all keys share the same format
  const queue: Array<{ original: string; normalized: string }> = [];
  const db = buildMapPath ? new LinkDb(buildMapPath) : null;
  if (db) {
    registerMapSave(() => db.close());
    setLoggerDb(db);
    if (imageDownloader) imageDownloader.setDb(db);
  }

  // Resume from DB if present
  if (db && db.size() > 0) {
    const dbVisited = new Set<string>();
    for (const u of db.visitedSet()) dbVisited.add(normalizeUrl(u));

    const dbProcessed = new Set<string>();
    for (const u of db.processedSet()) dbProcessed.add(normalizeUrl(u));

    const queued = new Set<string>();

    for (const url of dbVisited) {
      visited.add(url);
      if (!dbProcessed.has(url) && !queued.has(url)) {
        queued.add(url);
        queue.push({ original: url, normalized: url });
      }
    }
    for (const url of dbProcessed) {
      processed.add(url);
    }
    // Queue discovered-but-not-visited URLs (never fetched)
    for (const u of db.allUrls()) {
      const url = normalizeUrl(u);
      if (!queued.has(url) && !dbProcessed.has(url)) {
        visited.add(url);
        queue.push({ original: url, normalized: url });
      }
    }
    console.error(`Resuming ${queue.length} unprocessed of ${db.size()} discovered URLs.`);
    // Seed image counter from existing DB state
    if (imageDownloader && db.imageCount() > 0) {
      imageDownloader.completed = db.imageCount();
    }
  } else {
    visited.add(startNormalized);
    queue.push({ original: startUrl, normalized: startNormalized });
  }

  let visitedCount = db && db.size() > 0 ? db.visitedSet().size : 0;
  let processedCount = db && db.size() > 0 ? db.processedSet().size : 0;

  function progress() {
    const total = visited.size;
    const v = `visited: ${String(visitedCount).padStart(3)}/${total}`;
    const p = `processed: ${String(processedCount).padStart(3)}/${Math.max(visitedCount, 1)}`;
    let line = `  ${v}, ${p}`;
    if (imageDownloader) {
      line += `, images: ${imageDownloader.completed}/${imageDownloader.enqueued}`;
    }
    process.stderr.write(`\r${line}`);
  }

  async function processPage(url: string, normUrl: string): Promise<void> {
    if (processed.has(normUrl)) return;
    processed.add(normUrl);

    const { html, contentType, finalUrl } = await fetchHtml(url);
    if (finalUrl && finalUrl !== url) {
      if (isExcluded(finalUrl)) {
        progress();
        return;
      }
      if (urlFilter && !normalizeUrl(finalUrl).startsWith(normalizeUrl(urlFilter))) {
        progress();
        return;
      }
    }
    if (db) db.markVisited(normUrl, contentType);

    const discovered = await extractLinks(html, normUrl);
    if (db) {
      db.append(discovered.map((d) => ({ url: d.normalized, ct: "" })));
    }

    for (const { original: linkUrl, normalized } of discovered) {
      if (!visited.has(normalized)) {
        visited.add(normalized);
        if (limit === undefined || processed.size + queue.length < limit) {
          queue.push({ original: linkUrl, normalized });
        }
      }
    }

    if (isVisitOnly(url) || isVisitOnly(normUrl)) {
      log("INFO", `Visit-only: ${url}`);
      progress();
      return;
    }

    const extracted = extract(html, selector, matchRe);
        if (!extracted) {
          log("WARN", `No content found at ${url}`);
          progress();
      return;
    }
    visitedCount++;

    let contentHtml = extracted.contentHtml;
    const pageImages: { url: string; pageUrl: string; alt: string }[] = [];
    if (imageDownloader) {
      contentHtml = await preprocessImages(contentHtml, url, outputDir, (imgUrl, w, h, alt) => {
        imageDownloader.enqueue(imgUrl, w, h);
        pageImages.push({ url: imgUrl, pageUrl: url, alt: alt ?? "" });
      });
    }
    if (db && pageImages.length > 0) db.appendImage(pageImages);

    contentHtml = stripFilteredLinks(contentHtml, url);

    let mdBody = await htmlToMd(contentHtml);
    mdBody = mdBody.replace(/\s*\[​\]\(#[^)]+\)/g, "");
    mdBody = mdBody.replace(/\\-/g, "-");
    let rewritten = rewriteLinks(mdBody, url, resolvedBaseUrl);
    if (imageDownloader) {
      rewritten = rewriteMarkdownImages(rewritten, outputDir);
    }
    const fm = renderFrontmatter({
      title: extracted.title,
      description: extracted.description,
      source: url,
      date: extracted.date,
    });
    const outPath = mdPath(outputDir, url, resolvedBaseUrl);
    writeFile(outPath, fm + "\n" + rewritten + "\n");
    if (db) db.markProcessed(normUrl);
    processedCount++;
    progress();
  }

  while (queue.length > 0 && (limit === undefined || processed.size < limit)) {
    const batch = queue.splice(
      0,
      Math.min(resolvedConcurrent, limit !== undefined ? limit - processed.size : resolvedConcurrent)
    );

    const results = await Promise.allSettled(
      batch.map(({ original: url, normalized: normUrl }) => processPage(url, normUrl))
    );

    for (const r of results) {
      if (r.status === "rejected") {
        log("ERROR", `${r.reason}`);
        progress();
      }
    }

    if (queue.length > 0) {
      await Bun.sleep(interval);
    }
  }

  process.stderr.write("\n");

  // Export .json sitemap for portability
  if (db && db.size() > 0) {
    const jsonPath = buildMapPath!.replace(/\.sqlite\.db$/, ".json");
    db.exportJson(jsonPath, resolvedBaseUrl);
    log("INFO", `Exported ${db.size()} URLs to ${jsonPath}`);
  }

  console.error(`Done. ${processedCount} pages scraped.`);
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
  await imageDownloader?.stop();
  getChromeSession()?.close();
}
