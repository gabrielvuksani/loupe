import { describe, it, expect } from "vitest";
import { axeViolationsToFindings } from "../entrypoints/lib/axe-findings";

describe("axeViolationsToFindings", () => {
  it("maps axe violations to a11y findings with an axe: rule id and severity from impact", () => {
    const findings = axeViolationsToFindings([
      { id: "image-alt", impact: "critical", help: "Images must have alternate text", nodes: [{ target: ["img.hero"] }] },
      { id: "label", impact: "minor", help: "Form elements must have labels", nodes: [{ target: ["#email"] }] },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.ruleId).toBe("axe:image-alt");
    expect(findings[0]?.category).toBe("a11y");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.selector).toBe("img.hero");
    expect(findings[1]?.severity).toBe("low");
  });

  it("falls back to :root when a violation has no node target", () => {
    const findings = axeViolationsToFindings([
      { id: "html-lang", impact: "serious", help: "html element must have a lang attribute", nodes: [] },
    ]);
    expect(findings[0]?.selector).toBe(":root");
    expect(findings[0]?.severity).toBe("high");
  });
});
