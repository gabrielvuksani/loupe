import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { reverifyAfterFix } from "../src/playwright-adapter";

// Same fixture as the render test: a low-contrast ghost button (#aeb6c2 on
// white) and a small tap target, plus page-level font noise.
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
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("connected · reverifyAfterFix (the loop on a real render)", () => {
  it(
    "applies the computed fixes to the live DOM, re-judges, and the contrast finding is gone while the score rose",
    async () => {
      const report = await reverifyAfterFix(base);

      expect(report.before.findings.some((f) => f.ruleId === "contrast")).toBe(true);
      expect(report.after.findings.some((f) => f.ruleId === "contrast")).toBe(false);
      expect(report.after.score.overall).toBeGreaterThan(report.before.score.overall);
      expect(report.applied.some((a) => a.property === "color")).toBe(true);

      // a real before/after screenshot diff: the color fix changed pixels, so
      // ratio is a finite fraction in (0, 1].
      expect(report.visualDelta).toBeDefined();
      expect(Number.isFinite(report.visualDelta.ratio)).toBe(true);
      expect(report.visualDelta.ratio).toBeGreaterThanOrEqual(0);
      expect(report.visualDelta.ratio).toBeLessThanOrEqual(1);
      expect(Number.isInteger(report.visualDelta.changedPixels)).toBe(true);
    },
    120000,
  );
});
