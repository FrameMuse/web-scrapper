import { existsSync, mkdirSync } from "fs";

let chromeSession: ChromeSession | null = null;

export function setChromeEnabled(v: boolean, nTabs = 1): void {
  if (v && !chromeSession) {
    chromeSession = new ChromeSession();
    chromeSession.start(nTabs).catch((e) => {
      console.error("  Chrome session failed:", e.message);
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
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isChallengePage(html: string): boolean {
  return (
    html.includes("Just a moment...") ||
    html.includes("security verification") ||
    html.includes("cf-browser-verification") ||
    html.includes("challenges.cloudflare.com")
  );
}

// ---- CDP transport: send command, wait for result by id ----

class CdpConnection {
  private ws!: WebSocket;
  private msgId = 1;
  private pending = new Map<number, (val: any) => void>();
  private _ready = false;

  get ready(): boolean { return this._ready; }

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => { this._ready = true; resolve(); };
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.id && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg);
            this.pending.delete(msg.id);
          }
          // Also capture events for session-based listeners
          if (this.onEvent && msg.method) this.onEvent(msg);
        } catch {}
      };
      this.ws.onerror = () => reject(new Error("CDP WS error"));
    });
  }

  onEvent: ((msg: any) => void) | null = null;

  send(method: string, params?: Record<string, unknown>): number {
    const id = this.msgId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return id;
  }

  async call(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.send(method, params);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, 15000);
      this.pending.set(id, (msg: any) => {
        clearTimeout(timer);
        resolve(msg.result ?? msg);
      });
    });
  }

  async evaluate(expression: string): Promise<string> {
    const result = await this.call("Runtime.evaluate", { expression });
    return result?.result?.value ?? "";
  }

  close(): void {
    try { this.ws?.close(); } catch {}
  }
}

// ---- Chrome tab = one page with its own CDP connection ----

class ChromeTab {
  cdp: CdpConnection;
  ready: boolean = false;
  private _url: string = "";

  constructor(cdp: CdpConnection) {
    this.cdp = cdp;
  }

  async navigate(url: string): Promise<string> {
    await this.cdp.call("Page.enable");
    await this.cdp.call("Network.enable");

    // Capture content-type of the main-document response
    const mimeType = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), 10000);
      const handler = (msg: any) => {
        if (msg.method === "Network.responseReceived") {
          const resp = msg.params?.response;
          if (resp?.type === "Document" && resp?.mimeType) {
            clearTimeout(timer);
            this.cdp.onEvent = null;
            resolve(resp.mimeType);
          }
        }
      };
      this.cdp.onEvent = handler;
      this.cdp.call("Page.navigate", { url });
    });

    // If the server returned an image, skip this page
    if (/^image\//.test(mimeType)) {
      return "";
    }

    await Bun.sleep(1000);

    const html = await this.cdp.evaluate("document.documentElement.outerHTML");

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
      const title = await this.cdp.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) {
        return this.cdp.evaluate("document.documentElement.outerHTML");
      }
      await Bun.sleep(1000);
    }
    return null;
  }

  close(): void {
    this.cdp.close();
  }
}

// ---- Chrome session with tab pool ----

export class ChromeSession {
  private proc: import("child_process").ChildProcess | null = null;
  private browserCdp: CdpConnection | null = null;
  private tabs: ChromeTab[] = [];
  private free: ChromeTab[] = [];
  private waiters: ((tab: ChromeTab) => void)[] = [];
  private _ready: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this._ready = new Promise((r) => { this.readyResolve = r; });
  }

  async start(nTabs: number): Promise<void> {
    if (!existsSync(CHROME_PROFILE)) mkdirSync(CHROME_PROFILE, { recursive: true });

    // Launch headed Chrome, capture stderr for browser WS URL
    const proc = Bun.spawn([
      "google-chrome-stable",
      `--user-data-dir=${CHROME_PROFILE}`,
      "--no-first-run",
      "--no-remote",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    this.proc = proc;

    // Extract browser WebSocket URL from stderr
    const browserWsUrl = await this.readBrowserWsUrl(proc);

    // Connect to browser CDP
    console.error("  Connecting to browser...");
    this.browserCdp = new CdpConnection();
    await this.browserCdp.connect(browserWsUrl);
    await this.browserCdp.call("Target.setDiscoverTargets", { discover: true });

    // Create N tabs
    console.error(`  Creating ${nTabs} tabs...`);
    const tabIds: string[] = [];
    for (let i = 0; i < nTabs; i++) {
      const result = await this.browserCdp.call("Target.createTarget", {
        url: "about:blank",
      });
      if (result?.targetId) tabIds.push(result.targetId);
    }

    // Get WebSocket URLs for all tabs
    const allPages = await this.fetchJson();
    for (const tabId of tabIds) {
      const page = allPages.find((p: any) => p.id === tabId);
      if (page?.webSocketDebuggerUrl) {
        const cdp = new CdpConnection();
        await cdp.connect(page.webSocketDebuggerUrl);
        const tab = new ChromeTab(cdp);
        tab.ready = true;
        this.tabs.push(tab);
        this.free.push(tab);
      }
    }

    console.error(`  ${this.tabs.length} tabs ready.`);
    this.readyResolve();
  }

  get ready(): Promise<void> { return this._ready; }

  private async readBrowserWsUrl(proc: import("child_process").ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for DevTools URL")), 15000);
      const reader = proc.stderr!.getReader();
      const read = () => {
        reader.read().then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
          if (done) return;
          const text = new TextDecoder().decode(value);
          const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          } else {
            read();
          }
        });
      };
      read();
    });
  }

  private async fetchJson(): Promise<any[]> {
    for (let i = 0; i < 20; i++) {
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        return await resp.json();
      } catch {
        await Bun.sleep(200);
      }
    }
    return [];
  }

  async fetchHtml(url: string): Promise<string> {
    await this.ready;
    const tab = await this.acquireTab();
    try {
      return await tab.navigate(url);
    } finally {
      this.releaseTab(tab);
    }
  }

  focusAll(): void {
    if (this.browserCdp) {
      this.browserCdp.send("Target.activateTarget", { targetId: "..." });
    }
  }

  private async acquireTab(): Promise<ChromeTab> {
    if (this.free.length > 0) {
      return this.free.pop()!;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private releaseTab(tab: ChromeTab): void {
    if (this.waiters.length > 0) {
      this.waiters.shift()!(tab);
    } else {
      this.free.push(tab);
    }
  }

  close(): void {
    for (const t of this.tabs) t.close();
    this.browserCdp?.close();
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }
}

// ---- fetchHtml: HTTP first, then Chrome session ----

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
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
