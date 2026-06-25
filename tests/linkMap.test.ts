import { describe, test, expect } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import {
  inferContentType,
  addToMap,
  markVisited,
  markProcessed,
  loadLinkMap,
  saveLinkMap,
} from "../lib/linkMap.ts";

describe("linkMap", () => {
  test("inferContentType known extensions", () => {
    expect(inferContentType("https://site.com/image.jpg")).toBe("image/jpeg");
    expect(inferContentType("https://site.com/image.jpeg")).toBe("image/jpeg");
    expect(inferContentType("https://site.com/image.png")).toBe("image/png");
    expect(inferContentType("https://site.com/image.gif")).toBe("image/gif");
    expect(inferContentType("https://site.com/image.svg")).toBe("image/svg+xml");
    expect(inferContentType("https://site.com/video.mp4")).toBe("video/mp4");
    expect(inferContentType("https://site.com/audio.mp3")).toBe("audio/mpeg");
    expect(inferContentType("https://site.com/doc.pdf")).toBe("application/pdf");
    expect(inferContentType("https://site.com/style.css")).toBe("text/css");
  });

  test("inferContentType unknown returns null", () => {
    expect(inferContentType("https://site.com/page.html")).toBeNull();
    expect(inferContentType("https://site.com/page")).toBeNull();
    expect(inferContentType("not-a-url")).toBeNull();
  });

  test("inferContentType case insensitive", () => {
    expect(inferContentType("https://site.com/image.JPG")).toBe("image/jpeg");
    expect(inferContentType("https://site.com/Image.PNG")).toBe("image/png");
  });

  test("inferContentType with query params", () => {
    expect(inferContentType("https://site.com/image.jpg?w=200&h=100")).toBe("image/jpeg");
  });

  test("addToMap adds new URLs", () => {
    const map = {};
    addToMap(map, ["https://site.com/page/", "https://site.com/image.jpg"]);
    expect(map["https://site.com/page/"]).toEqual({
      visited: false, processed: false, contentType: null,
    });
    expect(map["https://site.com/image.jpg"]).toEqual({
      visited: false, processed: false, contentType: "image/jpeg",
    });
  });

  test("addToMap preserves existing entries", () => {
    const map = {
      "https://site.com/page/": { visited: true, processed: true, contentType: "text/html" },
    };
    addToMap(map, ["https://site.com/page/", "https://site.com/other/"]);
    expect(map["https://site.com/page/"]).toEqual({
      visited: true, processed: true, contentType: "text/html",
    });
    expect(map["https://site.com/other/"].visited).toBe(false);
  });

  test("markVisited sets visited and contentType", () => {
    const map = {};
    markVisited(map, "https://site.com/page/", "text/html; charset=utf-8");
    expect(map["https://site.com/page/"]).toEqual({
      visited: true, processed: false, contentType: "text/html; charset=utf-8",
    });
  });

  test("markVisited overrides contentType from extension", () => {
    const map = {
      "https://site.com/image.jpg": { visited: false, processed: false, contentType: "image/jpeg" },
    };
    markVisited(map, "https://site.com/image.jpg", "image/webp");
    expect(map["https://site.com/image.jpg"].contentType).toBe("image/webp");
  });

  test("markVisited without contentType preserves existing", () => {
    const map = {
      "https://site.com/page/": { visited: false, processed: false, contentType: null },
    };
    markVisited(map, "https://site.com/page/");
    expect(map["https://site.com/page/"].visited).toBe(true);
    expect(map["https://site.com/page/"].contentType).toBeNull();
  });

  test("markProcessed sets processed", () => {
    const map = {};
    markProcessed(map, "https://site.com/page/");
    expect(map["https://site.com/page/"]).toEqual({
      visited: false, processed: true, contentType: null,
    });
  });

  test("markProcessed on existing entry preserves other fields", () => {
    const map = {
      "https://site.com/page/": { visited: true, processed: false, contentType: "text/html" },
    };
    markProcessed(map, "https://site.com/page/");
    expect(map["https://site.com/page/"]).toEqual({
      visited: true, processed: true, contentType: "text/html",
    });
  });

  test("save and load round-trip", () => {
    const path = "/tmp/scrape-test-linkmap.json";
    try { unlinkSync(path); } catch {}
    const map = {
      "https://site.com/page/": { visited: true, processed: true, contentType: "text/html" },
      "https://site.com/image.jpg": { visited: false, processed: false, contentType: "image/jpeg" },
    };
    saveLinkMap(path, map);

    const loaded = loadLinkMap(path);
    expect(loaded).toEqual(map);

    unlinkSync(path);
  });

  test("loadLinkMap returns empty for missing file", () => {
    const map = loadLinkMap("/tmp/scrape-test-nonexistent.json");
    expect(map).toEqual({});
  });

  test("loadLinkMap returns empty for corrupt JSON", () => {
    const path = "/tmp/scrape-test-corrupt.json";
    const { writeFileSync } = require("fs");
    writeFileSync(path, "not-json", "utf-8");
    const map = loadLinkMap(path);
    expect(map).toEqual({});
    unlinkSync(path);
  });

  test("map keys are always fully qualified URLs", () => {
    const map = {};

    // Simulate a crawl: initial URL discovered and visited
    const initialUrl = "https://site.com/wiki/SomePage";
    const initialNorm = "https://site.com/wiki/SomePage/";

    addToMap(map, [initialNorm]);
    markVisited(map, initialNorm, "text/html");
    markProcessed(map, initialNorm);

    // Simulate discovering links from the page
    const discovered = [
      "https://site.com/wiki/OtherPage/",
      "https://site.com/wiki/AnotherPage/",
      "https://site.com/assets/image.jpg",
    ];
    addToMap(map, discovered);

    // All keys must have proper scheme
    for (const key of Object.keys(map)) {
      expect(key).toMatch(/^[a-z]+:\/\//);
      expect(key).not.toMatch(/^\/\//);
    }

    // The initial URL is stored with normalized key, matching discovered links' format
    expect(map[initialNorm].visited).toBe(true);
    expect(map[initialNorm].processed).toBe(true);
  });

  test("non-normalized input URL is stored under normalized key", () => {
    const map = {};
    const rawInput = "https://site.com/wiki/Page";
    const normInput = "https://site.com/wiki/Page/";

    // Simulate what crawlLinks does: normalize before storing in map
    markVisited(map, normInput, "text/html");
    markProcessed(map, normInput);

    expect(map[normInput].visited).toBe(true);
    expect(map[normInput].processed).toBe(true);
    // The raw input should NOT have a separate entry
    expect(map[rawInput]).toBeUndefined();
  });

  test("markVisited stores originalUrl", () => {
    const map = {};
    const norm = "https://site.com/wiki/Page/";
    markVisited(map, norm, "text/html", "https://site.com/wiki/Page");
    expect(map[norm].visited).toBe(true);
    expect(map[norm].url).toBe("https://site.com/wiki/Page");
  });

  test("markVisited without originalUrl leaves url undefined", () => {
    const map = {};
    markVisited(map, "https://site.com/wiki/Page/", "text/html");
    expect(map["https://site.com/wiki/Page/"].url).toBeUndefined();
  });

  test("markVisited updates originalUrl if provided", () => {
    const map = {
      "https://site.com/wiki/Page/": { visited: false, processed: false, contentType: null },
    };
    markVisited(map, "https://site.com/wiki/Page/", "text/html", "https://site.com/wiki/Page");
    expect(map["https://site.com/wiki/Page/"].url).toBe("https://site.com/wiki/Page");
  });

  test("markVisited does not overwrite originalUrl if not provided", () => {
    const map = {
      "https://site.com/wiki/Page/": { visited: false, processed: false, contentType: null, url: "https://site.com/wiki/Page" },
    };
    markVisited(map, "https://site.com/wiki/Page/", "text/html");
    expect(map["https://site.com/wiki/Page/"].url).toBe("https://site.com/wiki/Page");
  });
});

describe("resume from link map", () => {
  function simulateResume(map: Record<string, any>) {
    const processed = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ original: string; normalized: string }> = [];

    if (map && Object.keys(map).length > 0) {
      for (const [normUrl, entry] of Object.entries(map)) {
        if ((entry as any).visited) {
          visited.add(normUrl);
          if (!(entry as any).processed) {
            queue.push({ original: (entry as any).url || normUrl, normalized: normUrl });
          }
        }
        if ((entry as any).processed) {
          processed.add(normUrl);
        }
      }
    }

    return { processed, visited, queue };
  }

  test("resume with mixed state populates correctly", () => {
    const map = {
      "https://site.com/wiki/Done/": { visited: true, processed: true, contentType: "text/html" },
      "https://site.com/wiki/Unprocessed/": { visited: true, processed: false, contentType: "text/html" },
      "https://site.com/wiki/NotVisited/": { visited: false, processed: false, contentType: null },
      "https://site.com/image.jpg": { visited: false, processed: false, contentType: "image/jpeg" },
    };

    const { processed, visited, queue } = simulateResume(map);

    expect(processed.has("https://site.com/wiki/Done/")).toBe(true);
    expect(processed.has("https://site.com/wiki/Unprocessed/")).toBe(false);
    expect(processed.size).toBe(1);

    expect(visited.has("https://site.com/wiki/Done/")).toBe(true);
    expect(visited.has("https://site.com/wiki/Unprocessed/")).toBe(true);
    expect(visited.has("https://site.com/wiki/NotVisited/")).toBe(false);
    expect(visited.size).toBe(2);

    expect(queue.length).toBe(1);
    expect(queue[0].normalized).toBe("https://site.com/wiki/Unprocessed/");
  });

  test("resume with all processed yields empty queue", () => {
    const map = {
      "https://site.com/wiki/A/": { visited: true, processed: true, contentType: "text/html" },
      "https://site.com/wiki/B/": { visited: true, processed: true, contentType: "text/html" },
    };

    const { processed, visited, queue } = simulateResume(map);

    expect(processed.size).toBe(2);
    expect(visited.size).toBe(2);
    expect(queue.length).toBe(0);
  });

  test("resume with no processed yields full queue", () => {
    const map = {
      "https://site.com/wiki/A/": { visited: true, processed: false, contentType: "text/html" },
      "https://site.com/wiki/B/": { visited: true, processed: false, contentType: "text/html" },
    };

    const { processed, visited, queue } = simulateResume(map);

    expect(processed.size).toBe(0);
    expect(visited.size).toBe(2);
    expect(queue.length).toBe(2);
  });

  test("resume uses stored originalUrl when available", () => {
    const map = {
      "https://site.com/wiki/Page/": {
        visited: true, processed: false, contentType: "text/html",
        url: "https://site.com/wiki/Page", // non-normalized original
      },
    };

    const { queue } = simulateResume(map);
    expect(queue[0].original).toBe("https://site.com/wiki/Page");
    expect(queue[0].normalized).toBe("https://site.com/wiki/Page/");
  });

  test("resume falls back to normalized when no originalUrl", () => {
    const map = {
      "https://site.com/wiki/Page/": { visited: true, processed: false, contentType: "text/html" },
    };

    const { queue } = simulateResume(map);
    expect(queue[0].original).toBe("https://site.com/wiki/Page/");
  });

  test("resume with empty map starts fresh", () => {
    const startUrl = "https://site.com/wiki/Start";
    const startNorm = "https://site.com/wiki/Start/";

    const map = {};
    const { processed, visited, queue } = simulateResume(map);

    expect(processed.size).toBe(0);
    expect(visited.size).toBe(0);
    expect(queue.length).toBe(0);
  });
});
