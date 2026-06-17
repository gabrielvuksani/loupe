import { describe, it, expect } from "vitest";
import { nearestGaps, betweenGaps, type Box } from "../entrypoints/lib/measure";

// {top, right, bottom, left} mirrors the DOMRect edges the content script reads.
const box = (left: number, top: number, right: number, bottom: number): Box => ({ top, right, bottom, left });

describe("nearestGaps", () => {
  it("measures the gap to the nearest neighbor on the right that overlaps vertically", () => {
    const target = box(0, 0, 100, 50);
    const right = box(120, 0, 200, 50);
    expect(nearestGaps(target, [right]).right).toBe(20);
  });

  it("picks the closer of two candidates in the same direction", () => {
    const target = box(0, 0, 100, 50);
    const far = box(200, 0, 260, 50);
    const near = box(130, 0, 180, 50);
    expect(nearestGaps(target, [far, near]).right).toBe(30);
  });

  it("ignores a candidate on the right that does not overlap vertically", () => {
    const target = box(0, 0, 100, 50);
    const disjoint = box(120, 200, 200, 250); // far below, no vertical overlap
    expect(nearestGaps(target, [disjoint]).right).toBeUndefined();
  });

  it("measures top, left, and bottom gaps", () => {
    const target = box(100, 100, 200, 200);
    const above = box(100, 40, 200, 80); // bottom 80, gap 20
    const left = box(0, 100, 70, 200); // right 70, gap 30
    const below = box(100, 240, 200, 300); // top 240, gap 40
    const gaps = nearestGaps(target, [above, left, below]);
    expect(gaps.top).toBe(20);
    expect(gaps.left).toBe(30);
    expect(gaps.bottom).toBe(40);
  });

  it("returns an empty object when there are no neighbors", () => {
    expect(nearestGaps(box(0, 0, 100, 50), [])).toEqual({});
  });

  it("ignores overlapping elements (a parent or covering sibling)", () => {
    const target = box(50, 50, 150, 150);
    const overlapping = box(0, 0, 200, 200); // contains the target, no clean gap
    expect(nearestGaps(target, [overlapping])).toEqual({});
  });
});

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
