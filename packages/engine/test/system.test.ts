import { describe, it, expect } from "vitest";
import { systemFindings } from "../src/index";
import type { DesignSystem } from "../src/index";

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
