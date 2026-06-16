import { describe, it, expect } from "vitest";
import { analyzePage } from "../src/index";
import type { PageSnapshot } from "../src/index";

const clean: PageSnapshot = {
  fontFamilies: ["Inter"],
  fontSizesPx: [16, 24, 40],
  fontWeights: [400, 600],
  textColors: ["#111111"],
  spacings: [8, 16, 24],
};

describe("analyzePage: typography and palette taste rules", () => {
  it("flags too many font families (>2)", () => {
    const findings = analyzePage({ ...clean, fontFamilies: ["Inter", "Georgia", "Roboto"] });
    const f = findings.find((x) => x.ruleId === "font-variety");
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
    expect(f?.message).toMatch(/font famil/i);
  });

  it("flags type-scale steps closer than 25% (they read as the same size)", () => {
    // 16 → 18 is 1.125× apart, below the 1.25 minimum.
    const findings = analyzePage({ ...clean, fontSizesPx: [16, 18, 32] });
    const f = findings.find((x) => x.ruleId === "type-scale");
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
    expect(f?.message).toMatch(/25%|1\.25|apart/i);
  });

  it("flags too many distinct font weights (>3)", () => {
    const findings = analyzePage({ ...clean, fontWeights: [400, 500, 600, 700] });
    const f = findings.find((x) => x.ruleId === "font-weights");
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
  });

  it("returns no findings for a page with a clean, consistent system", () => {
    expect(analyzePage(clean)).toEqual([]);
  });
});
