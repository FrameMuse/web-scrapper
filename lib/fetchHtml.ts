import { existsSync, mkdirSync } from "fs";
import { playAlertSound } from "./alert";

let chromeSession: ChromeSession | null = null;

process.on("exit", () => {
  chromeSession?.close();
});
process.on("SIGINT", () => {
  chromeSession?.close();
  process.exit(130);
});
process.on("SIGTERM", () => {
  chromeSession?.close();
  process.exit(143);
});

export function setChromeEnabled(v: boolean, nTabs = 1, noJs = false): void {
  if (v && !chromeSession) {
    chromeSession = new ChromeSession();
    chromeSession.start(nTabs, noJs).catch((e) => {
      console.error("  Chrome session failed:", e.message);
    });
  } else if (!v && chromeSession) {
    chromeSession.close();
    chromeSession = null;
  }
}

export function setSaveImages(v: boolean): void {}

export function getChromeSession(): ChromeSession | null {
  return chromeSession;
}

const CHROME_PROFILE = process.env.HOME + "/.config/scrape/chrome-profile";
const BLOCKER_EXT = process.env.HOME + "/.config/scrape/blocker";
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
  private listeners = new Map<string, Set<(msg: any) => void>>();

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
          if (msg.method) {
            const fns = this.listeners.get(msg.method);
            if (fns) for (const fn of fns) fn(msg);
          }
        } catch {}
      };
      this.ws.onerror = () => reject(new Error("CDP WS error"));
    });
  }

  on(method: string, fn: (msg: any) => void): void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(fn);
  }

  off(method: string, fn: (msg: any) => void): void {
    this.listeners.get(method)?.delete(fn);
  }

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
  noJs: boolean;
  targetId: string;
  focusMe: (() => void) | null = null;

  constructor(cdp: CdpConnection, noJs: boolean, targetId: string) {
    this.cdp = cdp;
    this.noJs = noJs;
    this.targetId = targetId;
  }

  async navigate(url: string): Promise<{ html: string; contentType: string; finalUrl: string }> {
    await this.cdp.call("Page.enable");
    await this.cdp.call("Network.enable");

    // Block non-content resource types natively — no CDP round-trips
    await this.cdp.call("Network.setBlockedURLs", {
      urls: [
        "*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp", "*.svg", "*.ico", "*.bmp",
        "*.css",
        "*.woff", "*.woff2", "*.ttf", "*.eot", "*.otf",
        "*.mp4", "*.webm", "*.avi", "*.mov", "*.mkv",
        "*.mp3", "*.wav", "*.ogg", "*.flac",
      ],
    });

    // Capture content-type of the main-document response
    const mimeType = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), 10000);
      const onResponse = (msg: any) => {
        if (msg.method === "Network.responseReceived") {
          const params = msg.params;
          if (params?.type === "Document" && params?.response?.mimeType) {
            clearTimeout(timer);
            this.cdp.off("Network.responseReceived", onResponse);
            resolve(params.response.mimeType);
          }
        }
      };
      this.cdp.on("Network.responseReceived", onResponse);
      this.cdp.call("Page.navigate", { url });
    });

    if (/^image\//.test(mimeType)) {
      return { html: "", contentType: mimeType, finalUrl: url };
    }

    // Wait for DOMContentLoaded (HTML fully parsed, DOM ready)
    await new Promise<void>((resolve) => {
      const handler = (msg: any) => {
        if (msg.method === "Page.domContentEventFired") {
          this.cdp.off("Page.domContentEventFired", handler);
          resolve();
        }
      };
      this.cdp.on("Page.domContentEventFired", handler);
    });

    const html = await this.cdp.evaluate("document.documentElement.outerHTML");
    // Kill pending JS and network — we already have the HTML
    this.cdp.send("Page.stopLoading");

    // Check if page was redirected to a different domain (auth, sign-in, etc.)
    const currentUrl = await this.cdp.evaluate("document.location.href");
    try {
      const originalHost = new URL(url).hostname;
      const currentHost = new URL(currentUrl).hostname;
      if (originalHost !== currentHost) {
        return { html: "", contentType: mimeType, finalUrl: currentUrl };
      }
    } catch {}

    if (isChallengePage(html)) {
      if (this.noJs) {
        return await this.handleCaptchaWithJs();
      }
      console.error("  Captcha detected, waiting for solution...");
      const realHtml = await this.waitForContent();
      return { html: realHtml ?? html, contentType: mimeType, finalUrl: currentUrl };
    }

    return { html, contentType: mimeType, finalUrl: currentUrl };
  }

  private async waitForContent(timeoutMs = 120000): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const title = await this.cdp.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) {
        return this.cdp.evaluate("document.documentElement.outerHTML");
      }
    await Bun.sleep(100);
    }
    return null;
  }

  private async handleCaptchaWithJs(): Promise<{ html: string; contentType: string; finalUrl: string }> {
    console.error("\x07\x07\x07  CAPTCHA detected — solving in Chrome window");
    this.focusMe?.();
    await playAlertSound();

    await this.cdp.call("Emulation.setScriptExecutionDisabled", { value: false });
    await this.cdp.call("Page.reload");

    const start = Date.now();
    const timeoutMs = 300000;
    while (Date.now() - start < timeoutMs) {
      const title = await this.cdp.evaluate("document.title");
      if (title && !/just a moment/i.test(title)) {
        const html = await this.cdp.evaluate("document.documentElement.outerHTML");
        this.cdp.send("Page.stopLoading");
        await this.cdp.call("Emulation.setScriptExecutionDisabled", { value: true });
        const finalUrl = await this.cdp.evaluate("document.location.href");
        return { html, contentType: "text/html", finalUrl };
      }
      await Bun.sleep(500);
    }

    await this.cdp.call("Emulation.setScriptExecutionDisabled", { value: true });
    return { html: "", contentType: "text/html", finalUrl: "" };
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

  async start(nTabs: number, noJs = false): Promise<void> {
    if (!existsSync(CHROME_PROFILE)) mkdirSync(CHROME_PROFILE, { recursive: true });

    // Launch headed Chrome with blocker extension
    const chromeArgs = [
      "google-chrome-stable",
      `--user-data-dir=${CHROME_PROFILE}`,
      "--no-first-run",
      "--no-remote",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      `--load-extension=${BLOCKER_EXT}`,
      "about:blank",
    ];

    const proc = Bun.spawn(chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });

    proc.unref();
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
        const tab = new ChromeTab(cdp, !!noJs, tabId);
        tab.focusMe = () => {
          this.browserCdp?.send("Target.activateTarget", { targetId: tabId });
        };
        tab.ready = true;
        this.tabs.push(tab);
        this.free.push(tab);
      }
    }

    if (noJs) {
      await Promise.all(this.tabs.map(tab =>
        tab.cdp.call("Emulation.setScriptExecutionDisabled", { value: true })
      ));
      console.error(`  JavaScript disabled on ${this.tabs.length} tabs.`);
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
            reader.cancel();
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

  async fetchHtml(url: string): Promise<{ html: string; contentType: string; finalUrl: string }> {
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

export async function fetchHtml(url: string): Promise<{ html: string; contentType: string; finalUrl: string }> {
  if (chromeSession) {
    return chromeSession.fetchHtml(url);
  }
  try {
    return await fetchWithHttp(url);
  } catch (e) {
    throw e;
  }
}

async function fetchWithHttp(url: string): Promise<{ html: string; contentType: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return {
    html: await res.text(),
    contentType: res.headers.get("content-type") || "",
    finalUrl: url,
  };
}
