import { DOMParser } from "linkedom";

export const DEFAULT_SELECTORS = [
  "article",
  "main",
  ".content",
  "#content",
  ".post",
  ".entry",
  ".document",
  "#root",
  "body",
];

export interface Extracted {
  contentHtml: string;
  title: string;
  description: string;
  date?: string;
}

/**
 * Extract content from HTML using CSS selectors.
 * @param html      Full page HTML
 * @param selectors CSS selectors tried in order (first match wins)
 * @param matchRe   Explicit regex override (must have capture group)
 */
export function extract(
  html: string,
  selectors: string[],
  matchRe?: string,
): Extracted | null {
  const doc = new DOMParser().parseFromString(html, "text/html");

  let contentHtml: string | null = null;
  const useSelectors = selectors.length > 0 ? selectors : DEFAULT_SELECTORS;

  if (matchRe) {
    const re = new RegExp(matchRe);
    const m = re.exec(html);
    if (m && m[1]) {
      contentHtml = m[0];
      if (m.length > 1 && m[1]) contentHtml = m[1];
    }
  } else {
    for (const sel of useSelectors) {
      const el = doc.querySelector(sel);
      if (el) {
        contentHtml = el.outerHTML;
        break;
      }
    }
  }

  if (!contentHtml) return null;

  return {
    contentHtml: contentHtml.trim(),
    title: extractTitle(doc),
    description: extractDescription(doc),
    date: extractDate(doc),
  };
}

function extractTitle(doc: Document): string {
  const el = doc.querySelector("title");
  if (!el) return "";
  return el.textContent.replace(/\s*\|\s*[^|]*\s*$/i, "").trim();
}

function extractDescription(doc: Document): string {
  const el = doc.querySelector('meta[name="description"]');
  if (!el) return "";
  return (el.getAttribute("content") || "").replace(/&#x27;/g, "'");
}

function extractDate(doc: Document): string | undefined {
  const meta = doc.querySelector('meta[property="article:published_time"]');
  if (meta) return (meta.getAttribute("content") || "").split("T")[0];
  const time = doc.querySelector("time");
  if (time) return (time.getAttribute("datetime") || "").split("T")[0];
  return undefined;
}
