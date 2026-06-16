import type { ElementSnapshot, Finding } from "./types";
import { parseColor } from "./contrast";
import { converter } from "culori";

const toOklab = converter("oklab");
const FONT_TOL = 0.5; // px rounding tolerance
const COLOR_TOL = 0.02; // OKLab distance within which a color counts as on-palette

// The project's authored design tokens. Every field is optional, so a partial
// system (just a type scale, or just a palette) grades only what it declares.
export interface DesignSystem {
  fontSizes?: number[]; // px
  colors?: string[]; // any CSS color strings
  spacing?: number[]; // px (reserved for a future spacing rule)
}

function nearest(values: readonly number[], x: number): number {
  return values.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), values[0]!);
}

function oklabDistance(a: string, b: string): number | null {
  const ra = parseColor(a);
  const rb = parseColor(b);
  if (!ra || !rb) return null;
  const la = toOklab({ mode: "rgb", r: ra[0] / 255, g: ra[1] / 255, b: ra[2] / 255 });
  const lb = toOklab({ mode: "rgb", r: rb[0] / 255, g: rb[1] / 255, b: rb[2] / 255 });
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
}

// Grade an element against the project's authored tokens. An off-scale font size
// or off-palette color is an objective deviation with an exact nearest-token
// fix. This is the canonical design-system check: it grades against what the
// project declared, not only the universal taste invariants. It runs only when
// a token list is given, so a project without a system sees nothing.
export function systemFindings(snapshot: ElementSnapshot, system: DesignSystem): Finding[] {
  const findings: Finding[] = [];

  const fs = Number.parseFloat(snapshot.styles.fontSize ?? "");
  if (system.fontSizes?.length && Number.isFinite(fs) && fs > 0) {
    const onScale = system.fontSizes.some((t) => Math.abs(t - fs) <= FONT_TOL);
    if (!onScale) {
      const to = nearest(system.fontSizes, fs);
      findings.push({
        ruleId: "system-font-size",
        category: "taste",
        severity: "low",
        selector: snapshot.selector,
        message: `font-size ${Math.round(fs)}px is off your type scale (${system.fontSizes.join(", ")}). Nearest token is ${to}px.`,
        fix: {
          property: "font-size",
          from: `${Math.round(fs)}px`,
          to: `${to}px`,
          rationale: "Snap to the nearest authored type-scale step.",
        },
      });
    }
  }

  const color = snapshot.styles.color;
  if (system.colors?.length && color) {
    let best: { token: string; dist: number } | null = null;
    for (const token of system.colors) {
      const d = oklabDistance(color, token);
      if (d !== null && (!best || d < best.dist)) best = { token, dist: d };
    }
    if (best && best.dist > COLOR_TOL) {
      findings.push({
        ruleId: "system-color",
        category: "taste",
        severity: "low",
        selector: snapshot.selector,
        message: `color ${color} is not in your palette. Nearest token is ${best.token}.`,
        fix: {
          property: "color",
          from: color,
          to: best.token,
          rationale: "Snap to the nearest authored palette color.",
        },
      });
    }
  }

  return findings;
}
