import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { renderAndAnalyze } from "../src/playwright-adapter";

// A fixture page with intentional problems: 3 font families, a low-contrast
// button (#aeb6c2 on white ≈ 1.9:1), and a small tap target.
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>
<style>
  body { font-family: Inter, sans-serif; }
  h1 { font-family: Georgia, serif; font-size: 40px; }
  .note { font-family: Roboto, sans-serif; font-size: 13px; color: #555; }
  .ghost { color: #aeb6c2; background: #ffffff; font-size: 15px; padding: 4px 8px; border: 0; }
</style></head><body>
  <h1>Know your runway</h1>
  <p class="note">Cashflow, foreseen</p>
  <button class="ghost">Watch the tour</button>
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

describe("connected · renderAndAnalyze (real Playwright + axe-core + Lighthouse)", () => {
  it(
    "renders a real page and produces engine findings, axe results, and Lighthouse scores",
    async () => {
      const report = await renderAndAnalyze(base);

      // the deterministic engine ran against the real rendered DOM
      expect(report.elementsAnalyzed).toBeGreaterThan(0);
      expect(report.findings.some((f) => f.ruleId === "contrast")).toBe(true);
      expect(report.findings.some((f) => f.ruleId === "font-variety")).toBe(true);

      // axe-core ran for real
      expect(report.axe.violations).toBeGreaterThanOrEqual(0);

      // Lighthouse ran for real → a numeric accessibility score
      expect(typeof report.lighthouse.accessibility).toBe("number");
    },
    180000,
  );
});
