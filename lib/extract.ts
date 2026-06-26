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

/** Parse CSS selector like "div#id.class1.class2" into parts */
function parseCssSelector(sel: string) {
  const parts = sel.split(/(?=[#.])/);
  let tag = "div";
  let id: string | undefined;
  const classes: string[] = [];
  for (const p of parts) {
    if (p.startsWith(".")) classes.push(p.slice(1));
    else if (p.startsWith("#")) id = p.slice(1);
    else tag = p;
  }
  return { tag, id, classes };
}

/** Build opening tag regex from CSS selector */
function cssToOpenRegex(parsed: ReturnType<typeof parseCssSelector>): RegExp {
  const { tag, id, classes } = parsed;
  const constraints: string[] = [];
  if (id) constraints.push(`id="${id}"`);
  if (classes.length > 0) {
    // All classes within the same class="..." attribute
    const classPatterns = classes.map((c) => "\\b" + RegExp.escape(c) + "\\b");
    const classInner = classPatterns.join('[^"]*');
    constraints.push('class="[^"]*' + classInner + '[^"]*"');
  }
  const attrPattern = constraints.join("[^>]*?");
  return new RegExp(`<${tag}\\b[^>]*?${attrPattern}[^>]*?>`, "i");
}

/** Walk forward from pos, count balanced tags of given name */
function findCloseTag(html: string, tag: string, pos: number): number | null {
  const openPrefix = `<${tag}`;
  const closePrefix = `</${tag}`;
  const openLen = openPrefix.length;
  let depth = 1;
  let i = pos;

  while (i < html.length) {
    const nextClose = html.indexOf(closePrefix, i);
    if (nextClose === -1) return null;

    const nextOpen = html.indexOf(openPrefix, i);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const c = html[nextOpen + openLen];
      if (c === undefined || c === ' ' || c === '>' || c === '/' || c === '\t' || c === '\n') {
        depth++;
      }
      i = nextOpen + openLen;
    } else {
      let after = nextClose + closePrefix.length;
      while (after < html.length && (html[after] === ' ' || html[after] === '\t' || html[after] === '\n')) after++;
      if (after < html.length && html[after] === '>') {
        depth--;
        if (depth === 0) return after + 1;
        i = after + 1;
      } else {
        i = nextClose + closePrefix.length;
      }
    }
  }
  return null;
}

/** Try to extract content matching an open tag regex */
function tryExtract(html: string, openRe: RegExp, tag: string): string | null {
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index;
  const afterOpen = start + m[0].length;

  const end = findCloseTag(html, tag, afterOpen);
  if (end) return html.substring(start, end);

  return null;
}

/** Extract title from <title> tag */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s*\|\s*[^|]*\s*$/i, "").trim();
}

/** Extract description from <meta name="description"> */
function extractDescription(html: string): string {
  const m = html.match(
    /<meta[^>]+name="description"[^>]+content="([^"]*)"[^>]*\/?>/i
  );
  if (!m) return "";
  return m[1].replace(/&#x27;/g, "'");
}

/** Extract date from meta or time tag */
function extractDate(html: string): string | undefined {
  const m = html.match(
    /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/
  );
  if (m) return m[1].split("T")[0];
  const t = html.match(/<time[^>]+datetime="([^"]+)"/);
  return t ? t[1].split("T")[0] : undefined;
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
  matchRe?: string
): Extracted | null {
  // Strip script and style blocks for reliable tag balancing
  html = html.replace(/<script\b[^>]*?>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<style\b[^>]*?>[\s\S]*?<\/style\s*>/gi, "");

  let contentHtml: string | null = null;
  const useSelectors = selectors.length > 0 ? selectors : DEFAULT_SELECTORS;

  if (matchRe) {
    // Explicit regex override
    const re = new RegExp(matchRe);
    const m = re.exec(html);
    if (m && m[1]) {
      // If it matches full element (no capture group needed), use whole match
      contentHtml = m[0];
      // Prefer capture group if present
      if (m.length > 1 && m[1]) contentHtml = m[1];
    }
  } else {
    // Try each CSS selector in order
    for (const sel of useSelectors) {
      const parsed = parseCssSelector(sel);
      const openRe = cssToOpenRegex(parsed);
      const result = tryExtract(html, openRe, parsed.tag);
      if (result) {
        contentHtml = result;
        break;
      }
    }
  }

  if (!contentHtml) return null;

  return {
    contentHtml: contentHtml.trim(),
    title: extractTitle(html),
    description: extractDescription(html),
    date: extractDate(html),
  };
}
