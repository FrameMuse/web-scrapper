#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { fetchHtml } from "../lib/fetchHtml.ts";
import { extract } from "../lib/extract.ts";
import { renderFrontmatter } from "../lib/frontmatter.ts";
import { rewriteLinks } from "../lib/linkRewrite.ts";
import { mdPath, writeFile } from "../lib/save.ts";
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
      if (key === "selector") {
        if (!flags["selector"]) flags["selector"] = [];
        (flags["selector"] as string[]).push(val);
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
const outputDir = expandTilde((flags["output"] as string) ?? ".");
const singleUrl = positional[0];

const pipeMode = !hasFlags && !!singleUrl;

if (hasFlags && !urlBase && !urlFilter) {
  console.error("--url-base or --url-filter is required");
  process.exit(1);
}

const resolvedBaseUrl = urlBase || urlFilter || (singleUrl ? singleUrl : "");

// ---- helpers ----

async function htmlToMd(html: string): Promise<string> {
  const proc = spawnSync(CONVERTER, [], { input: html, encoding: "utf-8" });
  if (proc.error) throw new Error(`Converter failed: ${proc.error.message}`);
  const out = (proc.stdout ?? "").trimEnd();
  if (proc.status !== 0)
    throw new Error(`Converter exit code ${proc.status}: ${proc.stderr}`);
  return out;
}

async function scrapeOne(url: string): Promise<void> {
  const html = await fetchHtml(url);
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

  for (let i = 0; i < urls.length; i += concurrent) {
    const batch = urls.slice(i, i + concurrent);
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

    if (i + concurrent < urls.length) {
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

// ---- main ----

if (sitemapUrl) {
  if (pipeMode) {
    console.error("--sitemap requires --output for batch mode");
    process.exit(1);
  }
  await batchFromSitemap();
} else if (singleUrl) {
  await singlePage();
} else if (dryRun) {
  console.error("--dry-run requires --sitemap or a URL argument");
  process.exit(1);
} else {
  console.error("Usage:");
  console.error("  scrape <url>                              # pipe mode: stdout + auto-detect selectors");
  console.error("  scrape --selector=... <url>                # file mode: write .md, auto output dir");
  console.error("  scrape --selector=... --url-base=... <url> # file mode with link rewriting");
  console.error("  scrape --sitemap=URL --selector=... --url-base=... --output=DIR  # batch mode");
  process.exit(1);
}
