import type { ElementSnapshot, Finding, PageSnapshot } from "./types";
import { parseColor } from "./contrast";
import { converter, parse } from "culori";

const toOklab = converter("oklab");
const FONT_TOL = 0.5; // px rounding tolerance
const COLOR_TOL = 0.02; // OKLab distance within which a color counts as on-palette
const SPACING_TOL = 0.5; // px rounding tolerance for spacing

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

const FONT_NAME = /font|text/i;
const SPACE_NAME = /space|spacing|gap|gutter/i;

// Discover design tokens from a page's CSS custom properties so the design-system
// check works without a config file. Colors are taken from any property whose
// value is a color (the name does not matter); lengths are taken only when the
// name signals a category (font/text -> type scale, space/gap -> spacing), so a
// --radius or --width is never miscategorized. rem is resolved at a 16px base.
// This also covers Tailwind v4, whose @theme compiles to :root custom properties.
export function tokensFromCss(css: string): DesignSystem {
  const colors = new Set<string>();
  const fontSizes = new Set<number>();
  const spacing = new Set<number>();
  const re = /--([\w-]+)\s*:\s*([^;{}]+?)\s*(?:;|\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const name = m[1]!;
    const value = m[2]!.trim();
    if (parse(value)) {
      colors.add(value);
      continue;
    }
    const len = value.match(/^(-?\d*\.?\d+)(px|rem)$/);
    if (!len) continue;
    const px = Number(len[1]) * (len[2] === "rem" ? 16 : 1);
    if (!Number.isFinite(px) || px <= 0) continue;
    if (FONT_NAME.test(name)) fontSizes.add(px);
    else if (SPACE_NAME.test(name)) spacing.add(px);
  }
  const sys: DesignSystem = {};
  if (colors.size) sys.colors = [...colors];
  if (fontSizes.size) sys.fontSizes = [...fontSizes];
  if (spacing.size) sys.spacing = [...spacing];
  return sys;
}

// Union several token sources (e.g. loupe.tokens.json and the page's CSS
// variables) into one system, deduping each category and dropping empties.
export function mergeDesignSystems(...systems: DesignSystem[]): DesignSystem {
  const colors = new Set<string>();
  const fontSizes = new Set<number>();
  const spacing = new Set<number>();
  for (const s of systems) {
    for (const c of s.colors ?? []) colors.add(c);
    for (const f of s.fontSizes ?? []) fontSizes.add(f);
    for (const sp of s.spacing ?? []) spacing.add(sp);
  }
  const out: DesignSystem = {};
  if (colors.size) out.colors = [...colors];
  if (fontSizes.size) out.fontSizes = [...fontSizes];
  if (spacing.size) out.spacing = [...spacing];
  return out;
}

// Page-level companion: grade the page's spacing values against the authored
// spacing scale. This catches what the per-element rules cannot see (padding and
// margin are not in the element snapshot) and complements the universal
// spacing-scale rule, which only knows a 4px grid, not the project's own steps.
export function systemPageFindings(page: PageSnapshot, system: DesignSystem): Finding[] {
  if (!system.spacing?.length) return [];
  const scale = system.spacing;
  const offScale = [...new Set(page.spacings)]
    .filter((s) => s > 0 && !scale.some((t) => Math.abs(t - s) <= SPACING_TOL))
    .sort((a, b) => a - b);
  if (!offScale.length) return [];
  const named = offScale.slice(0, 6).map((s) => `${s}px`).join(", ");
  return [
    {
      ruleId: "system-spacing",
      category: "taste",
      severity: "low",
      selector: ":root",
      message: `Spacing ${named} ${offScale.length === 1 ? "is" : "are"} off your spacing scale (${scale.join(", ")}). Snap to the nearest authored step.`,
    },
  ];
}
