import { describe, it, expect } from "vitest";
import { profileDelta } from "../src/viewport";
import type { Finding } from "../src/types";

const contrast = (selector: string): Finding => ({
  ruleId: "contrast",
  category: "a11y",
  severity: "high",
  selector,
  message: `Text contrast on ${selector} is below the WCAG AA minimum.`,
});
const targetSize = (selector: string): Finding => ({
  ruleId: "target-size",
  category: "a11y",
  severity: "medium",
  selector,
  message: `Touch target ${selector} is below 44px.`,
});

describe("profileDelta", () => {
  it("flags a finding present in one profile but not another (dark-only contrast)", () => {
    const delta = profileDelta([
      { profile: "light", findings: [] },
      { profile: "dark", findings: [contrast("button.cta")] },
    ]);
    expect(delta.divergent).toHaveLength(1);
    const d = delta.divergent[0]!;
    expect(d.ruleId).toBe("contrast");
    expect(d.selector).toBe("button.cta");
    expect(d.in).toEqual(["dark"]);
    expect(d.notIn).toEqual(["light"]);
  });

  it("treats a finding present in every profile as common, not divergent", () => {
    const delta = profileDelta([
      { profile: "light", findings: [targetSize(".tap")] },
      { profile: "dark", findings: [targetSize(".tap")] },
    ]);
    expect(delta.divergent).toHaveLength(0);
    expect(delta.commonCount).toBe(1);
  });

  it("stays quiet when profiles carry identical findings (zero false positives)", () => {
    const delta = profileDelta([
      { profile: "light", findings: [contrast("a"), targetSize("b")] },
      { profile: "dark", findings: [contrast("a"), targetSize("b")] },
    ]);
    expect(delta.divergent).toHaveLength(0);
  });

  it("never reports divergence from a single profile", () => {
    const delta = profileDelta([{ profile: "light", findings: [contrast("a")] }]);
    expect(delta.divergent).toHaveLength(0);
  });

  it("records which profiles a divergent finding appears in and which it does not", () => {
    const delta = profileDelta([
      { profile: "desktop-light", findings: [] },
      { profile: "desktop-dark", findings: [contrast("h1")] },
      { profile: "phone-dark", findings: [contrast("h1")] },
    ]);
    expect(delta.divergent).toHaveLength(1);
    const d = delta.divergent[0]!;
    expect(d.selector).toBe("h1");
    expect(d.in).toEqual(["desktop-dark", "phone-dark"]);
    expect(d.notIn).toEqual(["desktop-light"]);
  });
});
