import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type BrowserContext } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Loaded into a real browser; the SW context is untyped.
declare const chrome: {
  tabs: {
    query: (q: object) => Promise<Array<{ id?: number }>>;
    sendMessage: (id: number, m: unknown) => void;
  };
  runtime: {
    onMessage: {
      addListener: (cb: (m: unknown) => void) => void;
      removeListener: (cb: (m: unknown) => void) => void;
    };
  };
};

const EXT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../extension/.output/chrome-mv3",
);

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>
<style>
  body { font-family: Inter, sans-serif; }
  h1 { font-family: Georgia, serif; font-size: 40px; }
  .note { font-family: Roboto, sans-serif; font-size: 13px; color: #555; }
  .ghost { color: #aeb6c2; background: #fff; font-size: 15px; padding: 4px 8px; border: 0; }
</style></head><body>
  <h1>Know your runway</h1>
  <p class="note">Cashflow, foreseen</p>
  <button class="ghost">Watch the tour</button>
</body></html>`;

let server: Server;
let base = "";
let ctx: BrowserContext;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
  // MV3 extension service workers require headed Chromium (works on macOS
  // without a display server).
  ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
});

afterAll(async () => {
  await ctx?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("extension · content script runs the engine in-page (real browser, loaded MV3)", () => {
  it("scans a real page via the built content script and returns deterministic findings", async () => {
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: "load" });

    let workers = ctx.serviceWorkers();
    let sw = workers[0];
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });

    const result = (await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = tabs[0]?.id;
      return await new Promise<unknown>((resolveP) => {
        const onMsg = (m: unknown): void => {
          if ((m as { type?: string })?.type === "page-result") {
            chrome.runtime.onMessage.removeListener(onMsg);
            resolveP(m);
          }
        };
        chrome.runtime.onMessage.addListener(onMsg);
        if (id != null) chrome.tabs.sendMessage(id, { type: "analyze-page" });
        setTimeout(() => resolveP({ timeout: true }), 10000);
      });
    })) as { timeout?: boolean; findings?: Array<{ ruleId: string }> };

    expect(result.timeout).toBeUndefined();
    expect(
      result.findings?.some((f) => f.ruleId === "contrast" || f.ruleId === "font-variety"),
    ).toBe(true);
    // axe-core ran in Standalone and merged its findings
    expect(result.findings?.some((f) => f.ruleId.startsWith("axe:"))).toBe(true);
  }, 60000);

  it("shows the on-page popover with the verdict when an element is inspected", async () => {
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: "load" });
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    await page.waitForTimeout(300);

    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = tabs[0]?.id;
      if (id != null) chrome.tabs.sendMessage(id, { type: "set-inspect", value: true });
    });
    await page.waitForTimeout(200);

    await page.click(".ghost");
    await page.waitForFunction(
      () => {
        const host = document.getElementById("loupe-lens-popover");
        return Boolean(
          host && host.style.display === "block" && (host.shadowRoot?.textContent ?? "").includes("/100"),
        );
      },
      { timeout: 10000 },
    );

    const pop = await page.evaluate(
      () => document.getElementById("loupe-lens-popover")?.shadowRoot?.textContent ?? "",
    );
    expect(pop.toLowerCase()).toContain("contrast");
  }, 60000);
});
