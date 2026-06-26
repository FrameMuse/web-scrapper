/**
 * Rewrite internal links starting with urlBase to relative .md paths.
 */
export function rewriteLinks(md: string, sourceUrl: string, urlBase: string): string {
  const basePath = new URL(urlBase).pathname.replace(/\/+$/, "/");
  const sourcePath = new URL(sourceUrl).pathname;
  const sourceRel = sourcePath.startsWith(basePath)
    ? sourcePath.substring(basePath.length).replace(/\/+$/, "")
    : sourcePath.replace(/\/+$/, "");

  const escapedBase = RegExp.escape(basePath);
  const linkRe = new RegExp(`\\]\\(${escapedBase}[^)]*\\)`, "g");

  return md.replace(linkRe, (match) => {
    const inner = match.slice(2, -1);
    const fragment = inner.includes("#") ? inner.substring(inner.indexOf("#")) : "";
    const noFragment = fragment ? inner.substring(0, inner.indexOf("#")) : inner;
    // Detect and separate the title attribute ` "title"` at the end
    const titleMatch = noFragment.match(/\s+"[^"]*"$/);
    const title = titleMatch ? titleMatch[0] : "";
    const noTitle = title ? noFragment.substring(0, noFragment.length - title.length) : noFragment;
    let target = noTitle.replace(/\/+$/, "");
    // Normalize: add trailing slash so startsWith works for root links
    const targetWithSlash = target + "/";
    const targetRel = targetWithSlash.startsWith(basePath)
      ? targetWithSlash.substring(basePath.length).replace(/\/+$/, "")
      : target;
    // Link to root (e.g. /docs/) → index
    if (targetRel === "") {
      const rel = relativeDocPath(sourceRel, "index");
      return `](${rel}.md${title}${fragment})`;
    }

    const rel = relativeDocPath(sourceRel, targetRel);
    return `](${rel}.md${title}${fragment})`;
  });
}

function relativeDocPath(from: string, to: string): string {
  const fromParts = from ? from.split("/") : [];
  const toParts = to ? to.split("/") : [];

  let common = 0;
  const maxCommon = Math.min(fromParts.length - 1, toParts.length - 1);
  while (common < maxCommon && fromParts[common] === toParts[common]) {
    common++;
  }

  const up = fromParts.length - 1 - common;
  const down = toParts.slice(common).join("/");
  return up > 0 ? "../".repeat(up) + down : down;
}
