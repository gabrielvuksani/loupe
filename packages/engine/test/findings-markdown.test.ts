import { describe, it, expect } from "vitest";
import { findingsToMarkdown } from "../src/index";
import type { Finding } from "../src/index";

const findings: Finding[] = [
  {
    ruleId: "contrast",
    category: "a11y",
    severity: "high",
    selector: ".ghost",
    message: "Text contrast 1.9:1 is below WCAG AA.",
    fix: { property: "color", from: "rgb(174,182,194)", to: "rgb(90,98,110)", rationale: "reach AA" },
  },
  {
    ruleId: "tabindex-order",
    category: "a11y",
    severity: "medium",
    selector: ".ghost",
    message: 'tabindex="2" forces a manual tab order.',
  },
  {
    ruleId: "font-variety",
    category: "taste",
    severity: "medium",
    selector: ":root",
    message: "3 font families in use.",
  },
];

describe("findingsToMarkdown: the whole-page batch packet", () => {
  it("groups findings by selector and lists each rule with its fix", () => {
    const md = findingsToMarkdown(findings, { url: "https://example.com", score: 71 });
    // groups the two .ghost findings under one heading
    expect(md.match(/### `\.ghost`/g)).toHaveLength(1);
    expect(md).toMatch(/### `:root`/);
    // each rule and its fix surface
    expect(md).toMatch(/contrast/);
    expect(md).toMatch(/tabindex-order/);
    expect(md).toMatch(/color.*rgb\(90,98,110\)/);
    // context line
    expect(md).toMatch(/3 finding\(s\)/);
    expect(md).toMatch(/score 71\/100/);
    expect(md).toMatch(/example\.com/);
  });

  it("handles an empty findings list without crashing", () => {
    const md = findingsToMarkdown([]);
    expect(md).toMatch(/0 finding\(s\)/);
  });
});
