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

  it("flags an inconsistent spacing scale when most spacings are off a 4px grid", () => {
    const findings = analyzePage({ ...clean, spacings: [3, 7, 11, 13, 17, 23, 29] });
    const f = findings.find((x) => x.ruleId === "spacing-scale");
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
  });

  it("does not flag spacing when values sit on a consistent grid", () => {
    const findings = analyzePage({ ...clean, spacings: [4, 8, 12, 16, 24, 32, 48] });
    expect(findings.find((x) => x.ruleId === "spacing-scale")).toBeUndefined();
  });

  it("flags a sprawling text palette of more than 8 distinct colors", () => {
    const findings = analyzePage({
      ...clean,
      textColors: [
        "#111111",
        "#222222",
        "#333333",
        "#444444",
        "#555555",
        "#666666",
        "#777777",
        "#888888",
        "#999999",
      ],
    });
    const f = findings.find((x) => x.ruleId === "color-count");
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
    expect(f?.severity).toBe("low");
    expect(f?.message).toMatch(/color|palette/i);
  });

  it("does not flag a restrained text palette of 8 or fewer colors", () => {
    const findings = analyzePage({
      ...clean,
      textColors: ["#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888"],
    });
    expect(findings.find((x) => x.ruleId === "color-count")).toBeUndefined();
  });

  it("counts repeated text colors once before judging palette size", () => {
    // Many samples, but only three distinct colors: not sprawl.
    const repeated = Array.from({ length: 30 }, (_, i) => ["#111", "#222", "#333"][i % 3]!);
    const findings = analyzePage({ ...clean, textColors: repeated });
    expect(findings.find((x) => x.ruleId === "color-count")).toBeUndefined();
  });

  it("returns no findings for a page with a clean, consistent system", () => {
    expect(analyzePage(clean)).toEqual([]);
  });
});
