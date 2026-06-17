import { describe, it, expect } from "vitest";
import { buildOutline } from "../entrypoints/lib/outline";

describe("buildOutline", () => {
  it("flags no skips for a well-nested sequence", () => {
    const o = buildOutline([
      { level: 1, text: "A" },
      { level: 2, text: "B" },
      { level: 3, text: "C" },
    ]);
    expect(o.entries.every((e) => !e.skipped)).toBe(true);
    expect(o.noH1).toBe(false);
  });

  it("flags a skipped level (h1 jumps to h3)", () => {
    const o = buildOutline([
      { level: 1, text: "A" },
      { level: 3, text: "C" },
    ]);
    expect(o.entries[1]?.skipped).toBe(true);
  });

  it("does not flag going back up the hierarchy (h3 to h1)", () => {
    const o = buildOutline([
      { level: 1, text: "A" },
      { level: 2, text: "B" },
      { level: 3, text: "C" },
      { level: 1, text: "D" },
    ]);
    expect(o.entries.map((e) => e.skipped)).toEqual([false, false, false, false]);
  });

  it("reports noH1 when the page has headings but no h1", () => {
    const o = buildOutline([
      { level: 2, text: "A" },
      { level: 3, text: "B" },
    ]);
    expect(o.noH1).toBe(true);
  });

  it("is empty-safe", () => {
    const o = buildOutline([]);
    expect(o.entries).toEqual([]);
    expect(o.noH1).toBe(false);
  });
});
