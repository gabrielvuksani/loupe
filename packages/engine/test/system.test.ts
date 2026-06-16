import { describe, it, expect } from "vitest";
import { systemFindings, systemPageFindings, tokensFromCss, mergeDesignSystems } from "../src/index";
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

describe("systemPageFindings: font-family conformance to the authored set", () => {
  const base: PageSnapshot = {
    fontFamilies: [],
    fontSizesPx: [],
    fontWeights: [],
    textColors: [],
    spacings: [],
  };
  const sys: DesignSystem = { fontFamilies: ["Inter", "Fraunces"] };

  it("flags a font family not in the authored set", () => {
    const f = systemPageFindings({ ...base, fontFamilies: ["Inter", "Georgia"] }, sys).find(
      (x) => x.ruleId === "system-font-family",
    );
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/Georgia/);
  });

  it("does not flag when every family is authored, case-insensitively", () => {
    const findings = systemPageFindings({ ...base, fontFamilies: ["inter", "Fraunces"] }, sys);
    expect(findings.find((x) => x.ruleId === "system-font-family")).toBeUndefined();
  });

  it("never flags generic families like system-ui or sans-serif", () => {
    const findings = systemPageFindings(
      { ...base, fontFamilies: ["Inter", "system-ui", "sans-serif"] },
      sys,
    );
    expect(findings.find((x) => x.ruleId === "system-font-family")).toBeUndefined();
  });

  it("returns nothing when no font-family tokens are declared", () => {
    const findings = systemPageFindings({ ...base, fontFamilies: ["Georgia"] }, {});
    expect(findings.find((x) => x.ruleId === "system-font-family")).toBeUndefined();
  });
});

describe("tokensFromCss: discover tokens from CSS custom properties", () => {
  const css = `:root {
    --color-primary: #2563eb;
    --ink: rgb(17, 24, 39);
    --text-lg: 18px;
    --font-size-base: 1rem;
    --space-4: 16px;
    --gap-sm: 8px;
    --radius: 8px;
    --shadow: 0 1px 2px rgba(0,0,0,.1);
  }`;

  it("pulls colors regardless of the property name", () => {
    const sys = tokensFromCss(css);
    expect(sys.colors).toContain("#2563eb");
    expect(sys.colors).toContain("rgb(17, 24, 39)");
  });

  it("pulls font sizes from font/text named lengths, converting rem to px", () => {
    const sys = tokensFromCss(css);
    expect(sys.fontSizes).toContain(18);
    expect(sys.fontSizes).toContain(16); // 1rem
  });

  it("pulls spacing from space/gap named lengths", () => {
    const sys = tokensFromCss(css);
    expect(sys.spacing).toContain(16);
    expect(sys.spacing).toContain(8);
  });

  it("does not miscategorize a radius length as font size or spacing", () => {
    const sys = tokensFromCss(css);
    expect(sys.fontSizes ?? []).not.toContain(8);
    expect(sys.spacing ?? []).not.toContain(8.0001);
    // 8px appears only via --gap-sm, never via --radius
  });

  it("returns an empty system for CSS with no usable custom properties", () => {
    expect(tokensFromCss("body { color: red; }")).toEqual({});
  });
});

describe("mergeDesignSystems: union token sources", () => {
  it("unions each category and dedupes, dropping empties", () => {
    const merged = mergeDesignSystems(
      { colors: ["#111"], fontSizes: [12] },
      { colors: ["#111", "#222"], spacing: [8] },
    );
    expect(merged.colors).toEqual(["#111", "#222"]);
    expect(merged.fontSizes).toEqual([12]);
    expect(merged.spacing).toEqual([8]);
  });

  it("returns an empty system when every source is empty", () => {
    expect(mergeDesignSystems({}, {})).toEqual({});
  });
});
