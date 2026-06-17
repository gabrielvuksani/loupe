import { describe, it, expect } from "vitest";
import { reducedMotionFindings } from "../src/motion";

describe("reducedMotionFindings", () => {
  it("flags an element that keeps animating infinitely while reduced motion is requested", () => {
    const findings = reducedMotionFindings([
      { selector: ".spinner", animationName: "spin", animationDuration: "1s", animationIterationCount: "infinite" },
    ]);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe("reduced-motion");
    expect(f.category).toBe("a11y");
    expect(f.selector).toBe(".spinner");
    expect(f.message).toMatch(/reduced motion/i);
  });

  it("ignores an element with no animation", () => {
    const findings = reducedMotionFindings([
      { selector: ".still", animationName: "none", animationDuration: "0s", animationIterationCount: "1" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("ignores a one-shot animation that plays once and stops", () => {
    const findings = reducedMotionFindings([
      { selector: ".fade", animationName: "fadeIn", animationDuration: "0.3s", animationIterationCount: "1" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("ignores an infinite iteration count with no actual animation (zero duration / none)", () => {
    const findings = reducedMotionFindings([
      { selector: ".noop", animationName: "none", animationDuration: "1s", animationIterationCount: "infinite" },
      { selector: ".zero", animationName: "spin", animationDuration: "0s", animationIterationCount: "infinite" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
