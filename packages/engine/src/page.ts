import type { Finding, PageSnapshot } from "./types";

const MIN_SCALE_RATIO = 1.25; // Refactoring UI: no two type-scale steps closer than 25%.
const MAX_FONT_FAMILIES = 2;
const MAX_FONT_WEIGHTS = 3;

// Page-level taste rules: bounded variety and a sane type scale.
export function analyzePage(snapshot: PageSnapshot): Finding[] {
  const findings: Finding[] = [];

  const families = distinct(snapshot.fontFamilies);
  if (families.length > MAX_FONT_FAMILIES) {
    findings.push({
      ruleId: "font-variety",
      category: "taste",
      severity: "medium",
      selector: ":root",
      message: `${families.length} font families in use. Limit to ${MAX_FONT_FAMILIES} for a coherent system.`,
    });
  }

  const weights = distinct(snapshot.fontWeights);
  if (weights.length > MAX_FONT_WEIGHTS) {
    findings.push({
      ruleId: "font-weights",
      category: "taste",
      severity: "low",
      selector: ":root",
      message: `${weights.length} font weights in use. Keep it to ${MAX_FONT_WEIGHTS}.`,
    });
  }

  // type-scale: neighbouring sizes closer than 25% read as the same size.
  const sizes = distinct(snapshot.fontSizesPx).sort((a, b) => a - b);
  for (let i = 1; i < sizes.length; i++) {
    const lo = sizes[i - 1]!;
    const hi = sizes[i]!;
    if (lo > 0 && hi / lo < MIN_SCALE_RATIO) {
      findings.push({
        ruleId: "type-scale",
        category: "taste",
        severity: "low",
        selector: ":root",
        message: `Font sizes ${lo}px and ${hi}px are ${Math.round((hi / lo - 1) * 100)}% apart, under the 25% minimum. Collapse to one.`,
      });
    }
  }

  return findings;
}

function distinct<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
