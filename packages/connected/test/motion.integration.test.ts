import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { renderProfiles } from "../src/playwright-adapter";

// `.always` spins forever with no media guard, so it ignores reduced motion.
// `.polite` only animates under prefers-reduced-motion: no-preference, so under
// reduce it stops and must NOT be flagged (the zero-false-positive control).
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>motion fixture</title>
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .always { width: 40px; height: 40px; background: #444; animation: spin 1s linear infinite; }
  .polite { width: 40px; height: 40px; background: #888; }
  @media (prefers-reduced-motion: no-preference) {
    .polite { animation: spin 1s linear infinite; }
  }
</style></head><body>
  <div class="always">a</div>
  <div class="polite">b</div>
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

describe("connected · renderProfiles reduced-motion + screenshots", () => {
  it(
    "flags an animation that ignores reduced motion, leaves a gated one alone, and returns a screenshot when asked",
    async () => {
      const report = await renderProfiles(
        base,
        [{ name: "rm", viewport: { width: 1024, height: 768 }, colorScheme: "light", reducedMotion: "reduce" }],
        { screenshots: true },
      );
      const p = report.profiles[0]!;
      expect(p.findings.some((f) => f.ruleId === "reduced-motion" && f.selector.includes("always"))).toBe(true);
      expect(p.findings.some((f) => f.ruleId === "reduced-motion" && f.selector.includes("polite"))).toBe(false);
      expect(typeof p.screenshot).toBe("string");
      expect(p.screenshot!.startsWith("data:image/png;base64,")).toBe(true);
    },
    180000,
  );

  it(
    "omits screenshots by default to keep the report lean",
    async () => {
      const report = await renderProfiles(base, [
        { name: "plain", viewport: { width: 1024, height: 768 }, colorScheme: "light" },
      ]);
      expect(report.profiles[0]!.screenshot).toBeUndefined();
    },
    180000,
  );
});
