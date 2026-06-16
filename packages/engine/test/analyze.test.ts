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

  it("offers a hue-preserving primary fix and a blend alternative, both reaching AA", () => {
    const bg = "rgb(255, 255, 255)";
    const findings = analyzeElement({
      selector: ".site-btn-ghost",
      tag: "button",
      styles: { color: "rgb(174, 182, 194)", backgroundColor: bg },
    });
    const fix = findings.find((f) => f.ruleId === "contrast")?.fix;
    expect(fix?.to).toBeDefined();
    expect(fix?.alternative?.to).toBeDefined();
    expect(contrastRatio(fix?.alternative?.to ?? "", bg) ?? 0).toBeGreaterThanOrEqual(4.5);
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

  it("exempts an inline text link from target size (WCAG 2.5.5 inline exception)", () => {
    const findings = analyzeElement({
      selector: "a.inline",
      tag: "a",
      text: "read more",
      styles: { display: "inline" },
      box: { width: 80, height: 18 },
    });
    expect(findings.find((f) => f.ruleId === "target-size")).toBeUndefined();
  });

  it("still flags a small inline-block link button below the minimum", () => {
    const findings = analyzeElement({
      selector: "a.btn",
      tag: "a",
      text: "Buy",
      styles: { display: "inline-block" },
      box: { width: 80, height: 30 },
    });
    expect(findings.find((f) => f.ruleId === "target-size")).toBeDefined();
  });
});

describe("analyzeElement: line length", () => {
  it("flags an over-wide line of body text whose estimated CPL exceeds 75", () => {
    // 700px / (16px * 0.5) = ~87 chars per line, well past the comfortable 75.
    const findings = analyzeElement({
      selector: "p.lede",
      tag: "p",
      text: "This is a long paragraph of body copy that runs far past a comfortable measure.",
      styles: { fontSize: "16px" },
      box: { width: 700, height: 96 },
    });

    const ll = findings.find((f) => f.ruleId === "line-length");
    expect(ll).toBeDefined();
    expect(ll?.category).toBe("taste");
    expect(ll?.severity).toBe("low");
    expect(ll?.message).toMatch(/45.*75|75.*char/i);
  });

  it("does not flag a comfortable measure around 65 characters", () => {
    // 520px / (16px * 0.5) = 65 chars per line, inside the comfortable band.
    const findings = analyzeElement({
      selector: "p.body",
      tag: "p",
      text: "This paragraph sits at a comfortable reading measure for body copy.",
      styles: { fontSize: "16px" },
      box: { width: 520, height: 72 },
    });
    expect(findings.find((f) => f.ruleId === "line-length")).toBeUndefined();
  });

  it("ignores short labels even when the element box is wide", () => {
    // A wide button with two characters must never be a line-length problem.
    const findings = analyzeElement({
      selector: "button.cta",
      tag: "button",
      text: "Go",
      styles: { fontSize: "16px" },
      box: { width: 700, height: 48 },
    });
    expect(findings.find((f) => f.ruleId === "line-length")).toBeUndefined();
  });
});

describe("analyzeElement: semantic tag", () => {
  it("flags a div that behaves as a button via its accessibility role", () => {
    const findings = analyzeElement({
      selector: "div.fake-btn",
      tag: "div",
      text: "Submit",
      styles: {},
      a11y: { role: "button", name: "Submit" },
    });

    const st = findings.find((f) => f.ruleId === "semantic-tag");
    expect(st).toBeDefined();
    expect(st?.category).toBe("a11y");
    expect(st?.severity).toBe("medium");
    expect(st?.message).toMatch(/button/i);
  });

  it("flags a span acting as a link", () => {
    const findings = analyzeElement({
      selector: "span.nav",
      tag: "span",
      text: "Pricing",
      styles: {},
      a11y: { role: "link", name: "Pricing" },
    });
    const st = findings.find((f) => f.ruleId === "semantic-tag");
    expect(st).toBeDefined();
    expect(st?.message).toMatch(/link|a /i);
  });

  it("does not flag a real button element that carries the button role", () => {
    const findings = analyzeElement({
      selector: "button.real",
      tag: "button",
      text: "Submit",
      styles: {},
      a11y: { role: "button", name: "Submit" },
    });
    expect(findings.find((f) => f.ruleId === "semantic-tag")).toBeUndefined();
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
