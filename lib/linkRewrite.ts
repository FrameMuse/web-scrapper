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

  md = md.replace(linkRe, (match) => {
    const inner = match.slice(2, -1);
    const fragment = inner.includes("#") ? inner.substring(inner.indexOf("#")) : "";
    const noFragment = fragment ? inner.substring(0, inner.indexOf("#")) : inner;
    const titleMatch = noFragment.match(/\s+"[^"]*"$/);
    const title = titleMatch ? titleMatch[0] : "";
    const noTitle = title ? noFragment.substring(0, noFragment.length - title.length) : noFragment;
    let target = noTitle.replace(/\/+$/, "");
    const targetWithSlash = target + "/";
    const targetRel = targetWithSlash.startsWith(basePath)
      ? targetWithSlash.substring(basePath.length).replace(/\/+$/, "")
      : target;
    if (targetRel === "") {
      const rel = relativeDocPath(sourceRel, "index");
      return `](${rel}.md${title}${fragment})`;
    }

    const rel = relativeDocPath(sourceRel, targetRel);
    return `](${rel}.md${title}${fragment})`;
  });

  // Rewrite hoisted reference-style definitions: [label]: url
  const refRe = /^\[([^\]]+)\]:\s*(\S+)(.*)/gm;
  md = md.replace(refRe, (match, label, url, rest) => {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }
    const pathWithSlash = path.replace(/\/+$/, "/");
    if (!pathWithSlash.startsWith(basePath)) return match;
    const targetRel = pathWithSlash.substring(basePath.length).replace(/\/+$/, "");
    if (targetRel === "") {
      return `[${label}]: ${relativeDocPath(sourceRel, "index")}.md${rest}`;
    }
    return `[${label}]: ${relativeDocPath(sourceRel, targetRel)}.md${rest}`;
  });

  return md;
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
