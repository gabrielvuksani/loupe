import { describe, it, expect } from "vitest";
import { responsiveFindings } from "../src/responsive";

describe("responsiveFindings", () => {
  it("flags horizontal overflow at a viewport width and names the worst element", () => {
    const findings = responsiveFindings([
      {
        width: 375,
        documentWidth: 412,
        overflow: [
          { selector: ".wide-table", overflowBy: 37 },
          { selector: ".hero", overflowBy: 5 },
        ],
      },
      { width: 1280, documentWidth: 1280, overflow: [] },
    ]);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe("responsive-overflow");
    expect(f.category).toBe("responsive");
    expect(f.severity).toBe("high");
    expect(f.message).toMatch(/375/);
    expect(f.message).toMatch(/\.wide-table/);
  });

  it("stays quiet when every viewport fits, within a 1px rounding tolerance", () => {
    const findings = responsiveFindings([
      { width: 375, documentWidth: 375, overflow: [] },
      { width: 1280, documentWidth: 1281, overflow: [] },
    ]);
    expect(findings).toHaveLength(0);
  });
});
