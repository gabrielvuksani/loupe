import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { visualDelta } from "../src/playwright-adapter";

// Build a solid-color PNG buffer of the given size.
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = rgb[0];
    png.data[o + 1] = rgb[1];
    png.data[o + 2] = rgb[2];
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("connected · visualDelta (pure PNG pixel diff)", () => {
  it("reports zero changed pixels and ratio 0 for identical images", () => {
    const a = solidPng(10, 10, [255, 255, 255]);
    const delta = visualDelta(a, solidPng(10, 10, [255, 255, 255]));
    expect(delta.changedPixels).toBe(0);
    expect(delta.ratio).toBe(0);
  });

  it("reports a finite ratio in (0,1] when images differ", () => {
    const before = solidPng(10, 10, [255, 255, 255]);
    const after = solidPng(10, 10, [0, 0, 0]);
    const delta = visualDelta(before, after);
    expect(Number.isFinite(delta.ratio)).toBe(true);
    expect(delta.ratio).toBeGreaterThan(0);
    expect(delta.ratio).toBeLessThanOrEqual(1);
    expect(delta.changedPixels).toBe(100);
  });

  it("does not throw on a dimension mismatch and returns ratio 1", () => {
    const before = solidPng(10, 10, [255, 255, 255]);
    const after = solidPng(20, 20, [255, 255, 255]);
    const delta = visualDelta(before, after);
    expect(delta.ratio).toBe(1);
    expect(Number.isFinite(delta.changedPixels)).toBe(true);
  });
});
