import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { renderProfiles } from "../src/playwright-adapter";
import { createServer as createMcpServer } from "../src/mcp-server";

// A page that is fine in light mode (near-black text on white) but drops to a
// low-contrast mid-grey on near-black under prefers-color-scheme: dark. A single
// light-mode render would never see the dark-mode contrast failure.
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>dark-contrast fixture</title>
<style>
  body { background: #ffffff; color: #1a1a1a; font-family: Inter, sans-serif; margin: 0; padding: 16px; }
  .headline { color: #1a1a1a; background: #ffffff; font-size: 18px; }
  @media (prefers-color-scheme: dark) {
    body { background: #111111; color: #eaeaea; }
    .headline { color: #3a3a3a; background: #111111; }
  }
</style></head><body>
  <p class="headline">Quarterly revenue is up and to the right this period for the whole team.</p>
</body></html>`;

let server: Server;
let base = "";

beforeAll(async () => {
  server = createHttpServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("connected · renderProfiles (multi-viewport + color-scheme emulation)", () => {
  it(
    "surfaces a contrast failure that appears only in dark mode",
    async () => {
      const report = await renderProfiles(base, [
        { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" },
        { name: "desktop-dark", viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
      ]);

      expect(report.profiles).toHaveLength(2);
      expect(report.profiles.every((p) => typeof p.score.overall === "number")).toBe(true);

      const darkOnly = report.delta.divergent.find((d) => d.ruleId === "contrast");
      expect(darkOnly).toBeDefined();
      expect(darkOnly!.in).toContain("desktop-dark");
      expect(darkOnly!.notIn).toContain("desktop-light");
    },
    180000,
  );

  it(
    "exposes the multi-profile render as the loupe_analyze_responsive MCP tool",
    async () => {
      const server = createMcpServer();
      const [clientT, serverT] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
      await Promise.all([server.connect(serverT), client.connect(clientT)]);

      const res = await client.callTool({
        name: "loupe_analyze_responsive",
        arguments: {
          url: base,
          profiles: [
            { name: "desktop-light", viewport: { width: 1280, height: 800 }, colorScheme: "light" },
            { name: "desktop-dark", viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
          ],
        },
      });
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
      const report = JSON.parse(text);
      expect(report.profiles).toHaveLength(2);
      expect(
        report.delta.divergent.some(
          (d: { ruleId: string; in: string[] }) => d.ruleId === "contrast" && d.in.includes("desktop-dark"),
        ),
      ).toBe(true);
      await client.close();
    },
    180000,
  );
});
