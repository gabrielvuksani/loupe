import { describe, it, expect } from "vitest";
import { reverifyElement } from "../src/index";

describe("reverifyElement: the deterministic loop", () => {
  it("applies an element's own computed fix and clears the finding, raising the score", () => {
    const result = reverifyElement({
      selector: ".site-btn-ghost",
      tag: "button",
      text: "Watch the tour",
      styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
    });

    expect(result.before.some((f) => f.ruleId === "contrast")).toBe(true);
    expect(result.after.some((f) => f.ruleId === "contrast")).toBe(false);
    expect(result.afterScore.overall).toBeGreaterThan(result.beforeScore.overall);
    expect(result.appliedFixes.map((f) => f.property)).toContain("color");
  });

  it("is a no-op for an already-compliant element, so the loop never invents work", () => {
    const result = reverifyElement({
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
    expect(result.appliedFixes).toEqual([]);
    expect(result.after).toEqual(result.before);
    expect(result.afterScore.overall).toBe(result.beforeScore.overall);
  });
});
