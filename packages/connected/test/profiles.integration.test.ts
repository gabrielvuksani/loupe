import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { renderProfiles } from "../src/playwright-adapter";

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
  server = createServer((_req, res) => {
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
});
