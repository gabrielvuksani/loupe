import type { Finding, PageSnapshot } from "./types";

const MIN_SCALE_RATIO = 1.25; // Refactoring UI: no two type-scale steps closer than 25%.
const MAX_FONT_FAMILIES = 2;
const MAX_FONT_WEIGHTS = 3;
const SPACING_GRID = 4; // Refactoring UI: spacing lives on a consistent scale.
const MIN_SPACING_SAMPLES = 6;
const MAX_TEXT_COLORS = 8; // Refactoring UI: a few greys plus an accent, not a sprawl.

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

  // color-count: too many text colors reads as an unplanned palette.
  const colors = distinct(snapshot.textColors);
  if (colors.length > MAX_TEXT_COLORS) {
    findings.push({
      ruleId: "color-count",
      category: "taste",
      severity: "low",
      selector: ":root",
      message: `${colors.length} distinct text colors in use. Keep to ${MAX_TEXT_COLORS} or fewer: a few greys plus an accent.`,
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

  // spacing-scale: arbitrary spacing values signal no underlying grid.
  const spacings = distinct(snapshot.spacings);
  if (spacings.length >= MIN_SPACING_SAMPLES) {
    const offGrid = spacings.filter((s) => s % SPACING_GRID !== 0).length;
    if (offGrid / spacings.length > 0.5) {
      findings.push({
        ruleId: "spacing-scale",
        category: "taste",
        severity: "low",
        selector: ":root",
        message: `${offGrid} of ${spacings.length} spacing values are off a ${SPACING_GRID}px grid. Snap spacing to a consistent scale.`,
      });
    }
  }

  return findings;
}

function distinct<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
