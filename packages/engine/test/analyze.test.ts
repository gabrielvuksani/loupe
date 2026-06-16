import { describe, it, expect } from "vitest";
import { analyzeElement, contrastRatio } from "../src/index";

describe("analyzeElement: contrast (WCAG AA)", () => {
  it("flags low-contrast text against its resolved background", () => {
    // Mirrors the real finding from the Lens prototype:
    // rgb(174,182,194) on white is about 1.9:1, fails AA.
    const findings = analyzeElement({
      selector: ".site-btn-ghost",
      tag: "button",
      text: "Watch the tour",
      styles: {
        color: "rgb(174, 182, 194)",
        backgroundColor: "rgb(255, 255, 255)",
        fontSize: "15px",
        fontWeight: "500",
      },
    });

    const contrast = findings.find((f) => f.ruleId === "contrast");
    expect(contrast).toBeDefined();
    expect(contrast?.category).toBe("a11y");
    expect(contrast?.message).toMatch(/WCAG AA/);
  });

  it("carries a computed fix whose color actually reaches AA against the same background", () => {
    const findings = analyzeElement({
      selector: ".site-btn-ghost",
      tag: "button",
      styles: {
        color: "rgb(174, 182, 194)",
        backgroundColor: "rgb(255, 255, 255)",
      },
    });

    const fix = findings.find((f) => f.ruleId === "contrast")?.fix;
    expect(fix?.property).toBe("color");
    expect(fix?.from).toBe("rgb(174, 182, 194)");

    // The suggested color must, deterministically, pass AA on the same background.
    const fixedRatio = contrastRatio(fix?.to ?? "", "rgb(255, 255, 255)");
    expect(fixedRatio).not.toBeNull();
    expect(fixedRatio ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the 3:1 large-text threshold, so mid-contrast large text passes", () => {
    // gray(140) on white is about 3.36:1, fails normal AA (4.5) but clears large-text (3.0).
    const findings = analyzeElement({
      selector: "h1.hero",
      tag: "h1",
      styles: {
        color: "rgb(140, 140, 140)",
        backgroundColor: "rgb(255, 255, 255)",
        fontSize: "32px",
        fontWeight: "400",
      },
    });
    expect(findings.find((f) => f.ruleId === "contrast")).toBeUndefined();
  });
});

describe("analyzeElement: target size", () => {
  it("flags an interactive element below the 44px minimum and computes a size fix", () => {
    const findings = analyzeElement({
      selector: "button.cta",
      tag: "button",
      text: "Go",
      styles: {},
      box: { width: 90, height: 32 },
    });

    const ts = findings.find((f) => f.ruleId === "target-size");
    expect(ts).toBeDefined();
    expect(ts?.category).toBe("a11y");
    expect(ts?.message).toMatch(/44/);
    expect(ts?.fix?.property).toBe("min-height");
    expect(ts?.fix?.to).toBe("44px");
  });
});

describe("analyzeElement: no false positives", () => {
  it("returns no findings for a compliant element", () => {
    const findings = analyzeElement({
      selector: "button.primary",
      tag: "button",
      text: "Get started",
      styles: {
        color: "rgb(255, 255, 255)",
        backgroundColor: "rgb(31, 27, 18)",
        fontSize: "15px",
        fontWeight: "600",
      },
      box: { width: 140, height: 48 },
    });
    expect(findings).toEqual([]);
  });
});
