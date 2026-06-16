import { describe, it, expect } from "vitest";
import { renderAndAnalyze } from "../src/playwright-adapter";

// Render real production pages through the deterministic engine to read the
// false-positive rate by eye. Gated (GOLDEYE_LIVE_REALWORLD=1) because it needs
// the network and live sites change. Assertions stay structural; the console
// output is the signal: a polished site should yield few taste findings, a
// trivial page almost none.
const live = Boolean(process.env["GOLDEYE_LIVE_REALWORLD"]);

const urls = ["https://example.com/", "https://news.ycombinator.com/", "https://stripe.com/"];

describe.runIf(live)("real-world · deterministic engine on production pages", () => {
  for (const url of urls) {
    it(`renders and analyzes ${url}`, async () => {
      const r = await renderAndAnalyze(url);
      const byRule = new Map<string, number>();
      for (const f of r.findings) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
      const summary = [...byRule]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      process.stdout.write(
        `\nGOLDEYE ${url}\n  score ${r.score.overall} (taste ${r.score.byCategory.taste}, a11y ${r.score.byCategory.a11y})` +
          `\n  elements ${r.elementsAnalyzed} · engine+xbrowser findings ${r.findings.length} · axe violations ${r.axe.violations}` +
          `\n  by rule: ${summary || "(none)"}\n`,
      );
      expect(r.score.overall).toBeGreaterThanOrEqual(0);
      expect(r.score.overall).toBeLessThanOrEqual(100);
      expect(Array.isArray(r.findings)).toBe(true);
    }, 120000);
  }
});
