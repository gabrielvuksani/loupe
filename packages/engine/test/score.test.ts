import { describe, it, expect } from "vitest";
import { scoreFindings } from "../src/index";
import type { Finding } from "../src/index";

const f = (category: Finding["category"], severity: Finding["severity"]): Finding => ({
  ruleId: "x",
  category,
  severity,
  selector: ".x",
  message: "m",
});

describe("scoreFindings", () => {
  it("is 100 with no findings", () => {
    const s = scoreFindings([]);
    expect(s.overall).toBe(100);
    expect(s.byCategory.a11y).toBe(100);
  });

  it("deducts by severity, per category and overall", () => {
    const s = scoreFindings([f("a11y", "high"), f("taste", "low")]);
    expect(s.byCategory.a11y).toBe(88); // 100 - 12
    expect(s.byCategory.taste).toBe(97); // 100 - 3
    expect(s.byCategory["cross-browser"]).toBe(100);
    expect(s.overall).toBe(85); // 100 - 12 - 3
  });

  it("clamps at 0", () => {
    const many = Array.from({ length: 20 }, () => f("a11y", "high"));
    expect(scoreFindings(many).overall).toBe(0);
  });
});
