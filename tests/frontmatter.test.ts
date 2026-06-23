import { describe, test, expect } from "bun:test";
import { renderFrontmatter } from "../lib/frontmatter.ts";

describe("renderFrontmatter", () => {
  test("title only", () => {
    const r = renderFrontmatter({ title: "Test" });
    expect(r).toMatch(/^---\n/);
    expect(r).toContain('title: "Test"');
    expect(r).toMatch(/---\n$/);
  });

  test("all fields", () => {
    const r = renderFrontmatter({
      title: "My Page",
      description: "A description",
      source: "https://example.com/page",
      date: "2024-01-15",
    });
    expect(r).toContain("title: \"My Page\"");
    expect(r).toContain("description: \"A description\"");
    expect(r).toContain("source: https://example.com/page");
    expect(r).toContain("date: 2024-01-15");
  });

  test("description with special chars", () => {
    const r = renderFrontmatter({
      title: "Test",
      description: "It's a \"great\" page",
    });
    expect(r).toContain('title: "Test"');
  });

  test("ends with newline after closing ---", () => {
    const r = renderFrontmatter({ title: "Test" });
    expect(r).toMatch(/---\n$/);
  });

  test("empty description omitted", () => {
    const r = renderFrontmatter({
      title: "Test",
      description: "",
      date: "2024-01-15",
    });
    expect(r).not.toContain("description");
    expect(r).toContain("date: 2024-01-15");
  });
});
