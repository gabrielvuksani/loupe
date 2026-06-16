import { describe, it, expect } from "vitest";
import { minimalAccessibleColor, alternativeAccessibleColor, contrastRatio } from "../src/index";
import { converter } from "culori";

const toOklch = converter("oklch");
const hueDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("minimalAccessibleColor: hue and chroma preserving OKLCH fix", () => {
  it("darkens to reach AA on a light background while keeping the hue (blue stays blue)", () => {
    const fg = "rgb(120, 170, 255)";
    const bg = "rgb(255, 255, 255)";
    const fixed = minimalAccessibleColor(fg, bg, 4.5);
    expect(fixed).not.toBeNull();
    expect(contrastRatio(fixed as string, bg) ?? 0).toBeGreaterThanOrEqual(4.5);
    expect(hueDiff(toOklch(fg)?.h ?? 0, toOklch(fixed as string)?.h ?? 0)).toBeLessThan(12);
  });

  it("lightens on a dark background and keeps more chroma than the blend alternative", () => {
    const fg = "rgb(40, 90, 70)";
    const bg = "rgb(20, 20, 20)";
    const oklchFix = minimalAccessibleColor(fg, bg, 4.5);
    const blendFix = alternativeAccessibleColor(fg, bg, 4.5);

    expect(contrastRatio(oklchFix as string, bg) ?? 0).toBeGreaterThanOrEqual(4.5);
    const c0 = toOklch(fg)?.c ?? 0;
    const cOk = toOklch(oklchFix as string)?.c ?? 0;
    const cBlend = toOklch(blendFix as string)?.c ?? 0;
    expect(cOk).toBeGreaterThan(cBlend);
    expect(cOk).toBeGreaterThan(c0 * 0.7);
  });
});
