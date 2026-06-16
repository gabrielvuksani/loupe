import type { Finding } from "./types";
import { parseColor } from "./contrast";
import { converter } from "culori";

const toOklab = converter("oklab");

// The four color-vision deficiencies loupe can simulate. The dichromacies
// (no L / no M / no S cones) are where hue confusion happens; achromatopsia is
// total color loss, offered for the overlay.
export type CvdType = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

// Row-major 3x3 simulation matrices, the de-facto web set (Machado / Viénot,
// as used by the common SVG colorblind filters). They are applied in gamma
// sRGB space, matching an SVG feColorMatrix with color-interpolation-filters
// set to sRGB. This is the single source of truth for both the detector below
// and the overlay the user toggles, so what loupe flags is exactly what the
// overlay shows.
export const CVD_MATRICES: Record<CvdType, readonly number[]> = {
  protanopia: [0.567, 0.433, 0.0, 0.558, 0.442, 0.0, 0.0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0.0, 0.7, 0.3, 0.0, 0.0, 0.3, 0.7],
  tritanopia: [0.95, 0.05, 0.0, 0.0, 0.433, 0.567, 0.0, 0.475, 0.525],
  achromatopsia: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
};

// Apply a deficiency matrix to an sRGB triplet (0-255), returning sRGB (0-255).
export function simulateCvd(
  [r, g, b]: readonly [number, number, number],
  type: CvdType,
): [number, number, number] {
  const m = CVD_MATRICES[type];
  const clamp = (n: number): number => Math.max(0, Math.min(255, n));
  return [
    clamp(m[0]! * r + m[1]! * g + m[2]! * b),
    clamp(m[3]! * r + m[4]! * g + m[5]! * b),
    clamp(m[6]! * r + m[7]! * g + m[8]! * b),
  ];
}

// The 20-value feColorMatrix string (4 rows of R G B A O) for the SVG overlay,
// derived from the same 3x3 so the simulation in the browser matches the engine.
export function svgColorMatrix(type: CvdType): string {
  const m = CVD_MATRICES[type];
  return [
    m[0], m[1], m[2], 0, 0,
    m[3], m[4], m[5], 0, 0,
    m[6], m[7], m[8], 0, 0,
    0, 0, 0, 1, 0,
  ].join(" ");
}

// Gating thresholds in OKLab distance, grounded in measured simulation deltas:
// safe pairs (blue/orange) barely move (worst ~0.29, ratio ~0.95) while genuine
// red/green traps collapse hard (worst ~0.14-0.20, ratio ~0.45-0.57).
const ACCENT_CHROMA = 0.05; // both colors must be saturated, not neutral grey
const DISTINCT = 0.15; // clearly different to normal vision (skip near-shades)
const CONFUSE = 0.22; // after simulation, perceptually close enough to confuse
const COLLAPSE_RATIO = 0.65; // and the separation shrank by at least a third

const DICHROMACIES: readonly CvdType[] = ["protanopia", "deuteranopia", "tritanopia"];
const AXIS: Record<string, string> = {
  protanopia: "red-green",
  deuteranopia: "red-green",
  tritanopia: "blue-yellow",
};

interface Lab {
  l: number;
  a: number;
  b: number;
  chroma: number;
}

function toLab([r, g, b]: [number, number, number]): Lab {
  const o = toOklab({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 });
  return { l: o.l, a: o.a, b: o.b, chroma: Math.hypot(o.a, o.b) };
}

function labDistance(a: Lab, b: Lab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

// color-vision: two colors a sighted viewer tells apart by hue alone, that
// collapse to nearly the same color for a color-blind viewer. WCAG contrast
// cannot catch this (the pair often has fine luminance contrast); the failure
// is relying on hue with no brightness cue to fall back on. Like
// responsive-overflow, no single computed fix is attached: the right remedy is
// a judgment call between recoloring and adding a non-color cue, so loupe
// detects precisely, names the pair and the deficiency, and leaves the fix to
// the agent.
export function colorVisionFindings(colors: readonly string[]): Finding[] {
  const parsed = colors
    .map((raw) => {
      const rgb = parseColor(raw);
      return rgb ? { raw, rgb, lab: toLab(rgb) } : null;
    })
    .filter((x): x is { raw: string; rgb: [number, number, number]; lab: Lab } => x !== null)
    .filter((x) => x.lab.chroma > ACCENT_CHROMA);

  const findings: Finding[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;
      const normal = labDistance(a.lab, b.lab);
      if (normal < DISTINCT) continue; // already similar to normal vision

      let worst: { type: CvdType; dist: number } | null = null;
      for (const type of DICHROMACIES) {
        const d = labDistance(toLab(simulateCvd(a.rgb, type)), toLab(simulateCvd(b.rgb, type)));
        if (!worst || d < worst.dist) worst = { type, dist: d };
      }
      if (!worst) continue;
      if (worst.dist < CONFUSE && worst.dist < normal * COLLAPSE_RATIO) {
        findings.push({
          ruleId: "color-vision",
          category: "a11y",
          severity: "medium",
          selector: ":root",
          message: `${a.raw} and ${b.raw} look distinct but collapse to nearly the same color under ${worst.type} (${AXIS[worst.type]} color blindness). Separate them by lightness or add a non-color cue (icon, label, pattern), not hue alone.`,
        });
      }
    }
  }
  return findings;
}
