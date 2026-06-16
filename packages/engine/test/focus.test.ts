import { describe, it, expect } from "vitest";
import { focusFindings } from "../src/index";
import type { FocusProbe } from "../src/index";

const base: FocusProbe = {
  selector: "button.ghost",
  focusOutlineStyle: "none",
  focusOutlineWidth: "0px",
  baseShadow: "none",
  focusShadow: "none",
  baseBorder: "0px none rgb(0, 0, 0)",
  focusBorder: "0px none rgb(0, 0, 0)",
};

describe("focusFindings: keyboard focus visibility", () => {
  it("flags an element with no visible focus indicator at all", () => {
    const f = focusFindings([base]).find((x) => x.ruleId === "focus-visible");
    expect(f).toBeDefined();
    expect(f?.category).toBe("a11y");
    expect(f?.severity).toBe("medium");
    expect(f?.fix).toBeUndefined();
  });

  it("does not flag when focus draws an outline", () => {
    const probe = { ...base, focusOutlineStyle: "solid", focusOutlineWidth: "2px" };
    expect(focusFindings([probe])).toEqual([]);
  });

  it("does not flag when focus changes the box-shadow (a focus ring)", () => {
    const probe = { ...base, focusShadow: "rgb(37, 99, 235) 0px 0px 0px 3px" };
    expect(focusFindings([probe])).toEqual([]);
  });

  it("does not flag when focus changes the border", () => {
    const probe = { ...base, focusBorder: "2px solid rgb(37, 99, 235)" };
    expect(focusFindings([probe])).toEqual([]);
  });
});
