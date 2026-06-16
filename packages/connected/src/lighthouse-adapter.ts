import { launch } from "chrome-launcher";
import { chromium } from "playwright";
// lighthouse ships ESM; its default export is the runner function.
import lighthouse from "lighthouse";

export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  "best-practices": number | null;
  seo: number | null;
}

// Lighthouse audit driving Playwright's bundled Chromium via chrome-launcher.
export async function runLighthouse(url: string): Promise<LighthouseScores> {
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const runner = lighthouse as unknown as (
      u: string,
      flags: Record<string, unknown>,
    ) => Promise<{ lhr: { categories: Record<string, { score: number | null } | undefined> } } | undefined>;
    const result = await runner(url, {
      port: chrome.port,
      output: "json",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      logLevel: "silent",
    });
    const cats = result?.lhr?.categories ?? {};
    const pct = (c?: { score: number | null }): number | null =>
      c && c.score != null ? Math.round(c.score * 100) : null;
    return {
      performance: pct(cats["performance"]),
      accessibility: pct(cats["accessibility"]),
      "best-practices": pct(cats["best-practices"]),
      seo: pct(cats["seo"]),
    };
  } finally {
    await chrome.kill();
  }
}
