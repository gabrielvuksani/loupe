import { describe, it, expect } from "vitest";
import { systemFindings, systemPageFindings } from "../src/index";
import type { DesignSystem, PageSnapshot } from "../src/index";

const system: DesignSystem = {
  fontSizes: [12, 14, 16, 20, 24, 32],
  colors: ["#111827", "#2563eb", "#ffffff"],
};

describe("systemFindings: conformance to the project's authored tokens", () => {
  it("flags a font size off the authored type scale with the nearest-token fix", () => {
    const f = systemFindings({ selector: "p.lede", tag: "p", styles: { fontSize: "17px" } }, system).find(
      (x) => x.ruleId === "system-font-size",
    );
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
    expect(f?.fix?.property).toBe("font-size");
    expect(f?.fix?.to).toBe("16px");
  });

  it("does not flag a font size that sits on the scale", () => {
    const findings = systemFindings({ selector: "p", tag: "p", styles: { fontSize: "16px" } }, system);
    expect(findings.find((x) => x.ruleId === "system-font-size")).toBeUndefined();
  });

  it("flags a color outside the palette with the nearest palette color as the fix", () => {
    const f = systemFindings(
      { selector: "p.note", tag: "p", styles: { color: "rgb(58, 58, 58)" } },
      system,
    ).find((x) => x.ruleId === "system-color");
    expect(f).toBeDefined();
    expect(f?.fix?.property).toBe("color");
    expect(system.colors).toContain(f?.fix?.to);
  });

  it("does not flag a color that is already a palette token", () => {
    const findings = systemFindings(
      { selector: "a", tag: "a", styles: { color: "rgb(37, 99, 235)" } },
      system,
    );
    expect(findings.find((x) => x.ruleId === "system-color")).toBeUndefined();
  });

  it("returns nothing when no tokens are provided", () => {
    expect(systemFindings({ selector: "p", tag: "p", styles: { fontSize: "17px", color: "rgb(58,58,58)" } }, {})).toEqual([]);
  });
});

describe("systemPageFindings: spacing conformance to the authored scale", () => {
  const sys: DesignSystem = { spacing: [4, 8, 12, 16, 24, 32] };
  const base: PageSnapshot = {
    fontFamilies: [],
    fontSizesPx: [],
    fontWeights: [],
    textColors: [],
    spacings: [],
  };

  it("flags spacing values off the authored spacing scale and names them", () => {
    const f = systemPageFindings({ ...base, spacings: [8, 13, 16, 17] }, sys).find(
      (x) => x.ruleId === "system-spacing",
    );
    expect(f).toBeDefined();
    expect(f?.category).toBe("taste");
    expect(f?.message).toMatch(/13px/);
    expect(f?.message).toMatch(/17px/);
  });

  it("does not flag when every spacing sits on the scale", () => {
    expect(systemPageFindings({ ...base, spacings: [8, 16, 24] }, sys)).toEqual([]);
  });

  it("returns nothing when no spacing tokens are declared", () => {
    expect(systemPageFindings({ ...base, spacings: [13, 17] }, {})).toEqual([]);
  });
});
