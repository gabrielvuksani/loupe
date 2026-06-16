import { describe, it, expect } from "vitest";
import { placePopover } from "../entrypoints/lib/position";

const vp = { width: 1280, height: 800 };
const pop = { width: 300, height: 200 };

describe("placePopover", () => {
  it("places the popover just below the element when there is room", () => {
    const out = placePopover({ top: 60, bottom: 100, left: 200 }, pop, vp, 8);
    expect(out.top).toBe(108);
    expect(out.left).toBe(200);
  });

  it("flips the popover above the element when below would overflow the bottom", () => {
    // element near the bottom: below (788..988) overflows vp height 800
    const out = placePopover({ top: 740, bottom: 780, left: 100 }, pop, vp, 8);
    // above = top - margin - height = 740 - 8 - 200
    expect(out.top).toBe(532);
    expect(out.left).toBe(100);
  });

  it("clamps the left edge when the element sits near the right edge", () => {
    const out = placePopover({ top: 60, bottom: 100, left: 1200 }, pop, vp, 8);
    // 1200 + 300 > 1280 - 8, so left = 1280 - 8 - 300
    expect(out.left).toBe(972);
  });

  it("clamps the left edge to the margin when the element is off-screen left", () => {
    const out = placePopover({ top: 60, bottom: 100, left: -50 }, pop, vp, 8);
    expect(out.left).toBe(8);
  });

  it("keeps the popover on-screen when it fits neither below nor above", () => {
    const huge = { width: 300, height: 900 };
    const out = placePopover({ top: 360, bottom: 400, left: 100 }, huge, vp, 8);
    // above is negative and below overflows, so clamp top to the margin
    expect(out.top).toBe(8);
  });

  it("defaults the margin to 8 when none is given", () => {
    const out = placePopover({ top: 60, bottom: 100, left: 200 }, pop, vp);
    expect(out.top).toBe(108);
  });
});
