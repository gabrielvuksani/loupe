import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type BrowserContext } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge } from "../src/ws-bridge";
import { startHttpMcp } from "../src/http-mcp";
import { createSelectionStore } from "../src/selection-store";

// The full headline pull flow with real components: a real browser running the
// built MV3 extension publishes the Lens selection over the WS bridge, and a
// real MCP-over-HTTP client (the exact transport an agent uses) pulls it. The
// only piece not present is the LLM deciding to call the tool, which is not a
// transport concern. Gated behind LOUPE_LIVE_PULL: it needs the built
// extension, headed Chromium, and the fixed WS port 8791.
const live = Boolean(process.env["LOUPE_LIVE_PULL"]);

declare const chrome: {
  tabs: {
    query: (q: object) => Promise<Array<{ id?: number }>>;
    sendMessage: (id: number, m: unknown) => void;
  };
};

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension/.output/chrome-mv3");

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>
<style>
  body { font-family: Inter, sans-serif; }
  h1 { font-size: 40px; }
  .ghost { color: #aeb6c2; background: #fff; font-size: 15px; padding: 4px 8px; border: 0; }
</style></head><body>
  <h1>Know your runway</h1>
  <button class="ghost">Watch the tour</button>
</body></html>`;

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
}

describe.runIf(live)("pull flow · real browser publishes, an HTTP MCP client pulls", () => {
  let fixture: Server;
  let base = "";
  let ctx: BrowserContext;
  let wss: ReturnType<typeof startBridge>;
  let httpServer: Server;
  let httpPort = 0;
  const store = createSelectionStore();

  beforeAll(async () => {
    fixture = createServer((_q, res) => {
      res.setHeader("content-type", "text/html");
      res.end(HTML);
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`;

    // The extension hardcodes ws://127.0.0.1:8791, so the bridge must use it.
    wss = startBridge(8791, store);
    await new Promise<void>((r) => wss.once("listening", () => r()));
    httpServer = startHttpMcp(0, store);
    httpPort = await new Promise<number>((r) =>
      httpServer.once("listening", () => r((httpServer.address() as AddressInfo).port)),
    );

    ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
  }, 60000);

  afterAll(async () => {
    await ctx?.close();
    await new Promise<void>((r) => httpServer?.close(() => r()));
    await new Promise<void>((r) => wss?.close(() => r()));
    await new Promise<void>((r) => fixture?.close(() => r()));
  });

  it("a Connected-mode Lens selection reaches loupe_get_selection over HTTP", async () => {
    const content = await ctx.newPage();
    await content.goto(base, { waitUntil: "load" });
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const extId = new URL(sw.url()).host;

    // Open the side panel and switch it to Connected mode. This opens the WS to
    // 127.0.0.1:8791 from a chrome-extension:// origin, exercising the bridge's
    // origin allow-list with a real extension.
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "load" });
    await panel.click('#mode .pill[data-mode="connected"]');
    await panel.fill("#root", "/tmp/loupe-pull");
    await panel.fill("#request", "make it the primary button");
    // The panel's WS reaching the bridge proves the chrome-extension:// origin is
    // accepted; wait on that rather than a blind timeout.
    const connected = await waitFor(() => wss.clients.size >= 1, 10000);
    expect(connected, "side panel WS did not connect to the bridge").toBe(true);

    // Make the content page the active tab so set-inspect targets it, not the panel.
    await content.bringToFront();
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = tabs[0]?.id;
      if (id != null) chrome.tabs.sendMessage(id, { type: "set-inspect", value: true });
    });
    await content.waitForTimeout(200);

    // The agent's transport: a real MCP client over HTTP.
    const client = new Client({ name: "agent", version: "0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`)));

    // Re-select until the publish lands, covering the WS-open race.
    let text = "";
    for (let i = 0; i < 15 && !/ghost/.test(text); i++) {
      await content.click(".ghost").catch(() => {});
      await content.waitForTimeout(1000);
      const res = await client.callTool({ name: "loupe_get_selection", arguments: {} });
      text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? "").join(" ");
    }

    expect(text).toMatch(/ghost/);
    expect(text.toLowerCase()).toContain("contrast");
    // The enriched context a weak model needs: an exact selector to target and
    // where the element sits, both captured by the real content script.
    expect(text).toContain("target:");
    expect(text).toMatch(/at viewport \(/);
    // The user's request, typed in the Lens, reaches the pulling agent.
    expect(text).toMatch(/User request: make it the primary button/);
    await client.close();
  }, 120000);
});
