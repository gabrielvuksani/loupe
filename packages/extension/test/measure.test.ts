import { describe, it, expect } from "vitest";
import { betweenGaps, type Box } from "../entrypoints/lib/measure";

// {top, right, bottom, left} mirrors the DOMRect edges the content script reads.
const box = (left: number, top: number, right: number, bottom: number): Box => ({ top, right, bottom, left });

describe("betweenGaps", () => {
  it("measures the horizontal gap for side-by-side elements", () => {
    const g = betweenGaps(box(0, 0, 100, 50), box(120, 0, 200, 50));
    expect(g.dx).toBe(20);
    expect(g.dy).toBeUndefined();
  });

  it("measures the vertical gap for stacked elements", () => {
    const g = betweenGaps(box(0, 0, 100, 50), box(0, 80, 100, 130));
    expect(g.dy).toBe(30);
    expect(g.dx).toBeUndefined();
  });

  it("measures both gaps for a diagonal pair", () => {
    const g = betweenGaps(box(0, 0, 100, 50), box(150, 100, 200, 150));
    expect(g.dx).toBe(50);
    expect(g.dy).toBe(50);
  });

  it("returns no gap when the two elements overlap on both axes", () => {
    expect(betweenGaps(box(0, 0, 100, 100), box(50, 50, 150, 150))).toEqual({});
  });

  it("is order-independent (b to the left of a)", () => {
    expect(betweenGaps(box(200, 0, 300, 50), box(0, 0, 100, 50)).dx).toBe(100);
  });
});
