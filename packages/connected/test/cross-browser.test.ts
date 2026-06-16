import { describe, it, expect } from "vitest";
import { crossBrowserFindings, resolveTargets, bcdBrowser } from "../src/cross-browser";

describe("connected · crossBrowserFindings (pure, BCD-backed)", () => {
  it("flags a property unsupported in an old target and stays silent on a universal one", () => {
    // gap: version_added === false on ie. color: supported on ie since v3.
    // Targeting ie 11 + a modern chrome, only gap should produce a finding.
    const findings = crossBrowserFindings(["gap", "color"], ["ie 11", "chrome 120"]);

    const gap = findings.filter((f) => f.selector.includes("gap"));
    const color = findings.filter((f) => f.selector.includes("color"));

    expect(gap).toHaveLength(1);
    expect(color).toHaveLength(0);

    const finding = gap[0]!;
    expect(finding.category).toBe("cross-browser");
    expect(finding.ruleId).toBe("cross-browser");
    expect(["low", "medium"]).toContain(finding.severity);
    // the message names the property and the unsupported browser
    expect(finding.message).toContain("gap");
    expect(finding.message.toLowerCase()).toContain("ie");
  });

  it("emits nothing when every used property is supported by every target", () => {
    expect(crossBrowserFindings(["color", "display"], ["chrome 120", "safari 15"])).toHaveLength(0);
  });

  it("ignores unknown or custom properties without throwing", () => {
    // a CSS custom property and a nonexistent property must not crash BCD lookup
    expect(crossBrowserFindings(["--brand-color", "not-a-real-property"], ["ie 11"])).toEqual([]);
  });

  it("emits one finding per property even when several targets lack support", () => {
    // gap is unsupported on both ie 11 and ie 10; still a single finding that
    // names both browsers, not one per browser.
    const findings = crossBrowserFindings(["gap"], ["ie 11", "ie 10", "chrome 120"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message.toLowerCase()).toContain("ie 11");
    expect(findings[0]!.message.toLowerCase()).toContain("ie 10");
  });
});

describe("connected · resolveTargets (browserslist wrapper)", () => {
  it("returns a non-empty list of '<browser> <version>' tokens for the default query", () => {
    const targets = resolveTargets();
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => /\S+\s+\S+/.test(t))).toBe(true);
  });
});

describe("connected · bcdBrowser (name mapping)", () => {
  it("maps browserslist names to BCD keys and drops unmappable ones", () => {
    expect(bcdBrowser("ie")).toBe("ie");
    expect(bcdBrowser("ios_saf")).toBe("safari_ios");
    expect(bcdBrowser("and_chr")).toBe("chrome_android");
    expect(bcdBrowser("samsung")).toBe("samsunginternet_android");
    expect(bcdBrowser("op_mini")).toBeUndefined();
  });
});
