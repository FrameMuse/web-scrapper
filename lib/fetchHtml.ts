import { existsSync, mkdirSync } from "fs";

let chromeEnabled = false;
const CHROME_PROFILE = "/tmp/scrape-chrome-profile";
const CDP_PORT = 9223;

export function setChromeEnabled(v: boolean): void {
  chromeEnabled = v;
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
  return { ok: proc.exitCode === 0, stdout: proc.stdout.toString() };
}

/// Wait for challenge to resolve via CDP, return the real page HTML
async function waitForRealContent(wsUrl: string, timeoutMs = 120000): Promise<string | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const start = Date.now();

    ws.onopen = () => poll();

    function poll() {
      if (Date.now() - start > timeoutMs) {
        ws.close();
        resolve(null);
        return;
      }
      const id = msgId++;
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: "document.title" },
      }));
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.id && msg.result?.result?.value) {
          const title: string = msg.result.result.value;
          if (!/just a moment/i.test(title)) {
            // Challenge resolved — grab full page
            const grabId = msgId++;
            ws.send(JSON.stringify({
              id: grabId,
              method: "Runtime.evaluate",
              params: { expression: "document.documentElement.outerHTML" },
            }));
            ws.onmessage = (ev2: MessageEvent) => {
              try {
                const m2 = JSON.parse(ev2.data as string);
                if (m2.id === grabId) {
                  ws.close();
                  resolve(m2.result?.result?.value ?? null);
                }
              } catch {}
            };
            return;
          }
        }
      } catch {}
      // Poll again after delay
      setTimeout(poll, 1000);
    };

    ws.onerror = () => resolve(null);
  });
}

async function fetchWithChrome(url: string): Promise<string> {
  const useProfile = chromeEnabled || existsSync(CHROME_PROFILE);
  if (!existsSync(CHROME_PROFILE)) {
    mkdirSync(CHROME_PROFILE, { recursive: true });
  }

  // Try headless first
  const r = chromeDumpDom(url, true, useProfile ? CHROME_PROFILE : undefined);
  if (!r.ok) throw new Error(`Chrome failed for ${url}`);
  if (!isChallengePage(r.stdout)) return r.stdout;

  // Challenge detected — launch headed browser with CDP, wait for user to solve
  console.error(`  Opening browser for captcha...`);
  Bun.spawn(["google-chrome-stable", ...chromeArgs(CHROME_PROFILE, CDP_PORT), url], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  // Poll CDP until challenge resolves
  console.error(`  Waiting for captcha to be solved (CDP)...`);
  const wsUrl = await discoverCdpTarget(CDP_PORT);
  if (wsUrl) {
    const html = await waitForRealContent(wsUrl);
    if (html) {
      if (!isChallengePage(html)) {
        console.error(`  Captcha solved, content captured.`);
        return html;
      }
      console.error(`  CDP returned challenge page unexpectedly.`);
    } else {
      console.error(`  CDP wait timed out.`);
    }
  } else {
    console.error(`  Could not connect to Chrome debug port.`);
  }

  // Fallback: headless dump with profile (cookies may persist)
  console.error(`  Fallback: headless dump...`);
  const r2 = chromeDumpDom(url, true, CHROME_PROFILE);
  if (r2.ok && !isChallengePage(r2.stdout)) return r2.stdout;

  return r.stdout;
}

async function discoverCdpTarget(port: number, retries = 20): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(`http://localhost:${port}/json`);
      const pages = await resp.json() as Array<{ webSocketDebuggerUrl?: string }>;
      const wsUrl = pages.find((p) => p.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
      if (wsUrl) return wsUrl;
    } catch {}
    await Bun.sleep(500);
  }
  return null;
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
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  });
}
