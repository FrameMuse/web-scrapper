import { existsSync, mkdirSync } from "fs";

let chromeSession: ChromeSession | null = null;

export function setChromeEnabled(v: boolean): void {
  if (v && !chromeSession) {
    chromeSession = new ChromeSession();
    // Start async, but don't await — cli will await before first fetch
    chromeSession.start().catch((e) => {
      console.error("  Chrome session failed:", e.message);
      chromeSession = null;
    });
  } else if (!v && chromeSession) {
    chromeSession.close();
    chromeSession = null;
  }
}

export function getChromeSession(): ChromeSession | null {
  return chromeSession;
}

const CHROME_PROFILE = "/tmp/scrape-chrome-profile";
const CDP_PORT = 9223;

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

/// Persistent Chrome session — one browser, one tab, navigate in place
export class ChromeSession {
  private proc: import("child_process").ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 1;
  private readyResolve: (() => void) | null = null;
  private ready = new Promise<void>((r) => { this.readyResolve = r; });
  private tabId: string | null = null;

  async start(): Promise<void> {
    if (!existsSync(CHROME_PROFILE)) mkdirSync(CHROME_PROFILE, { recursive: true });

    console.error("  Starting Chrome session...");
    // Launch headed Chrome with CDP
    this.proc = Bun.spawn(["google-chrome-stable", ...chromeArgs(CHROME_PROFILE, CDP_PORT), "about:blank"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    // Wait for CDP to be ready
    const wsUrl = await this.discoverTarget();
    if (!wsUrl) throw new Error("Could not connect to Chrome debug port");
    console.error("  CDP connected, opening WebSocket...");

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      console.error("  WebSocket open, session ready.");
      this.send("Page.enable");
      this.readyResolve?.();
    };
  }

  async fetchHtml(url: string): Promise<string> {
    await this.ready;

    // Navigate to URL and wait for result
    const navId = this.msgId++;
    this.ws!.send(JSON.stringify({ id: navId, method: "Page.navigate", params: { url } }));

    // Wait for navigation result (the JSON response with id=navId)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 15000);
      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.id === navId) {
            clearTimeout(timer);
            this.ws!.removeEventListener("message", handler);
            resolve();
          }
        } catch {}
      };
      this.ws!.addEventListener("message", handler);
    });

    // Small delay to let page render
    await Bun.sleep(1000);

    // Get page content
    const html = await this.evaluate("document.documentElement.outerHTML");

    if (isChallengePage(html)) {
      console.error("  Captcha detected, waiting for solution...");
      const realHtml = await this.waitForContent();
      return realHtml ?? html;
    }

    return html;
  }

  private async waitForContent(timeoutMs = 120000): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const title = await this.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) {
        return this.evaluate("document.documentElement.outerHTML");
      }
      await Bun.sleep(1000);
    }
    return null;
  }

  private async evaluate(expression: string): Promise<string> {
    const id = this.msgId++;
    this.ws!.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression } }));
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.ws!.removeEventListener("message", handler); resolve(""); }, 10000);
      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.id === id) {
            clearTimeout(timer);
            this.ws!.removeEventListener("message", handler);
            resolve(msg.result?.result?.value ?? "");
          }
        } catch {}
      };
      this.ws!.addEventListener("message", handler);
    });
  }

  private send(method: string, params?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ id: this.msgId++, method, params }));
  }

  private async discoverTarget(retries = 30): Promise<string | null> {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const pages = await resp.json() as Array<{ webSocketDebuggerUrl?: string }>;
        const wsUrl = pages.find((p) => p.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
        if (wsUrl) return wsUrl;
      } catch {}
      await Bun.sleep(500);
    }
    return null;
  }

  close(): void {
    this.ws?.close();
    if (this.proc) {
      try { process.kill(this.proc.pid!); } catch {}
      this.proc = null;
    }
  }
}

export async function fetchHtml(url: string): Promise<string> {
  if (chromeSession) {
    return chromeSession.fetchHtml(url);
  }
  try {
    return await fetchWithHttp(url);
  } catch (e) {
    throw e;
  }
}

async function fetchWithHttp(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
