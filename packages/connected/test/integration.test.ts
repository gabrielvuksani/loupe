import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderAndAnalyze } from "../src/playwright-adapter";

const here = dirname(fileURLToPath(import.meta.url));
const systemApp = join(here, "fixtures", "system-app");

// A fixture page with intentional problems: 3 font families, a low-contrast
// button (#aeb6c2 on white is about 1.9:1), a small tap target, and a 500px
// element that overflows a 375px mobile viewport.
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>
<style>
  :root { --text-base: 16px; --text-lg: 24px; --color-ink: #111827; }
  body { font-family: Inter, sans-serif; }
  h1 { font-family: Georgia, serif; font-size: 40px; }
  .note { font-family: Roboto, sans-serif; font-size: 13px; color: #555; }
  .ghost { color: #aeb6c2; background: #ffffff; font-size: 15px; padding: 4px 8px; border: 0; }
  .wide { width: 500px; height: 10px; background: #eee; }
</style></head><body>
  <h1>Know your runway</h1>
  <p class="note">Cashflow, foreseen</p>
  <button class="ghost">Watch the tour</button>
  <a href="#main" class="skip" tabindex="2">Skip ahead</a>
  <img src="logo.png">
  <div class="wide"></div>
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

      // axe-core ran for real: the alt-less image is an unambiguous violation
      expect(report.axe.violations).toBeGreaterThan(0);
      expect(report.axe.details.some((d) => d.id === "image-alt")).toBe(true);

      // the responsive probe caught the 500px element overflowing at 375px
      expect(report.findings.some((f) => f.ruleId === "responsive-overflow")).toBe(true);

      // the positive tabindex on the skip link was flagged
      expect(report.findings.some((f) => f.ruleId === "tabindex-order")).toBe(true);

      // with no project root, the design-system check stays silent
      expect(report.findings.some((f) => f.ruleId.startsWith("system-"))).toBe(false);

      // Lighthouse ran for real → a numeric accessibility score
      expect(typeof report.lighthouse.accessibility).toBe("number");
    },
    180000,
  );

  it(
    "grades the page against a project's loupe.tokens.json when a root is given",
    async () => {
      const report = await renderAndAnalyze(base, systemApp);
      // the 13px note and 15px button text are off the [16, 24, 40] type scale
      expect(report.findings.some((f) => f.ruleId === "system-font-size")).toBe(true);
    },
    180000,
  );

  it(
    "discovers tokens from the page's own CSS variables when there is no tokens file",
    async () => {
      // `here` has no loupe.tokens.json, so the only tokens are the page's :root
      // custom properties (--text-base 16, --text-lg 24); 13px and 15px are off.
      const report = await renderAndAnalyze(base, here);
      expect(report.findings.some((f) => f.ruleId === "system-font-size")).toBe(true);
    },
    180000,
  );
});
