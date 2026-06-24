/**
 * Rewrite internal links starting with urlBase to relative .md paths.
 */
export function rewriteLinks(md: string, sourceUrl: string, urlBase: string): string {
  const basePath = new URL(urlBase).pathname.replace(/\/+$/, "/");
  const sourcePath = new URL(sourceUrl).pathname;
  const sourceRel = sourcePath.startsWith(basePath)
    ? sourcePath.substring(basePath.length).replace(/\/+$/, "")
    : sourcePath.replace(/\/+$/, "");

  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const fromDirs = fromParts.length > 0 ? fromParts.slice(0, -1) : [];
  const toDirs = toParts.length > 0 ? toParts.slice(0, -1) : [];

  let common = 0;
  while (
    common < fromDirs.length &&
    common < toDirs.length &&
    fromDirs[common] === toDirs[common]
  ) {
    common++;
  }

  const up = fromDirs.length - common;
  const down = toDirs.slice(common).concat(toParts.slice(-1));
  const prefix = up > 0 ? "../".repeat(up) : "";
  return prefix + down.join("/");
}
