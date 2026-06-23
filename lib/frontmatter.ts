export interface Frontmatter {
  title: string;
  description?: string;
  source?: string;
  date?: string;
}

export function renderFrontmatter(fm: Frontmatter): string {
  const lines = ["---"];
  lines.push(`title: ${JSON.stringify(fm.title)}`);
  if (fm.description) lines.push(`description: ${JSON.stringify(fm.description)}`);
  if (fm.source) lines.push(`source: ${fm.source}`);
  if (fm.date) lines.push(`date: ${fm.date}`);
  lines.push("---", "");
  return lines.join("\n");
}
