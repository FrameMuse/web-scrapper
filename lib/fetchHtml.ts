import { existsSync, mkdirSync } from "fs";

let chromeEnabled = false;
let interactiveEnabled = false;
const CHROME_PROFILE = "/tmp/scrape-chrome-profile";
const CDP_PORT = 9223;

export function setChromeEnabled(v: boolean): void {
  chromeEnabled = v;
}

export function setInteractive(v: boolean): void {
  interactiveEnabled = v;
}

function isChallengePage(html: string): boolean {
  return (
    html.includes("Just a moment...") ||
    html.includes("security verification") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenges.cloudflare.com")
  );
}

function chromeArgs(profile?: string, debuggingPort?: number): string[] {
  const args: string[] = [];
  if (profile) args.push(`--user-data-dir=${profile}`);
  args.push(
    "--no-first-run",
    "--no-remote",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-gpu",
  );
  if (debuggingPort) args.push(`--remote-debugging-port=${debuggingPort}`);
  return args;
}

function chromeDumpDom(url: string, headless: boolean, profile?: string): { ok: boolean; stdout: string } {
  const args = chromeArgs(profile);
  if (headless) args.unshift("--headless");
  args.push("--dump-dom", url);

  const proc = Bun.spawnSync(["google-chrome-stable", ...args], {});
  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
  };
}

async function fetchViaCdp(): Promise<string | null> {
  try {
    // Get page targets from Chrome devtools
    const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
    const pages = await resp.json() as Array<{ id: string; webSocketDebuggerUrl: string }>;
    if (pages.length === 0) return null;

    const wsUrl = pages[0].webSocketDebuggerUrl;
    if (!wsUrl) return null;

    // Connect to CDP WebSocket and evaluate document
    const ws = new WebSocket(wsUrl);
    const result = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => { ws.close(); resolve(null); }, 5000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: "document.documentElement.outerHTML" },
        }));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.id === 1) {
            clearTimeout(timeout);
            ws.close();
            resolve(msg.result?.result?.value ?? null);
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timeout); resolve(null); };
    });

    return result;
  } catch {
    return null;
  }
}

async function fetchWithChrome(url: string, isRetry = false): Promise<string> {
  const useProfile = interactiveEnabled || existsSync(CHROME_PROFILE);
  if (interactiveEnabled && !existsSync(CHROME_PROFILE)) {
    mkdirSync(CHROME_PROFILE, { recursive: true });
  }

  const r = chromeDumpDom(url, true, useProfile ? CHROME_PROFILE : undefined);
  if (!r.ok) {
    throw new Error(`Chrome failed for ${url}`);
  }

  if (interactiveEnabled && !isRetry && isChallengePage(r.stdout)) {
    // Open headed Chrome with CDP for content extraction
    Bun.spawn(["google-chrome-stable", ...chromeArgs(CHROME_PROFILE, CDP_PORT), url], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    console.error("  Cloudflare challenge detected.");
    console.error("  Solve the captcha in the opened browser, then press Enter.");

    // Wait for user to press Enter
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });

    // Get content via CDP from the already-loaded page
    const html = await fetchViaCdp();
    if (html && !isChallengePage(html)) {
      return html;
    }

    // Fallback: try headless dump with the profile
    const r2 = chromeDumpDom(url, true, CHROME_PROFILE);
    if (r2.ok && !isChallengePage(r2.stdout)) {
      return r2.stdout;
    }

    return r.stdout;
  }

  return r.stdout;
}

export async function fetchHtml(url: string): Promise<string> {
  try {
    return await fetchWithHttp(url);
  } catch (e) {
    if (chromeEnabled) {
      console.error(`  HTTP failed, trying Chrome: ${url}`);
      return fetchWithChrome(url);
    }
    throw e;
  }
}

function fetchWithHttp(url: string): Promise<string> {
  return fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  });
}
