import { describe, it, expect } from "vitest";
import { cropRect } from "../entrypoints/lib/crop";

const img = { width: 1280, height: 800 };

describe("cropRect", () => {
  it("scales the element rect by the device pixel ratio", () => {
    const r = { left: 100, top: 50, width: 40, height: 20 };
    const out = cropRect(r, 2, { width: 4000, height: 4000 }, 0);
    // origin scales by dpr, no padding subtracted at 0 pad
    expect(out.sx).toBe(200);
    expect(out.sy).toBe(100);
    expect(out.sw).toBe(80);
    expect(out.sh).toBe(40);
  });

  it("applies padding scaled by dpr around the element", () => {
    const r = { left: 100, top: 50, width: 40, height: 20 };
    const out = cropRect(r, 2, { width: 4000, height: 4000 }, 6);
    const pad = 6 * 2;
    expect(out.sx).toBe(200 - pad);
    expect(out.sy).toBe(100 - pad);
    expect(out.sw).toBe(80 + pad * 2);
    expect(out.sh).toBe(40 + pad * 2);
  });

  it("never lets sx or sy go negative at the top-left edge", () => {
    const r = { left: 0, top: 0, width: 40, height: 20 };
    const out = cropRect(r, 2, img, 6);
    expect(out.sx).toBe(0);
    expect(out.sy).toBe(0);
    // width still includes the padding that would have extended left of 0
    expect(out.sw).toBe(40 * 2 + 6 * 2 * 2);
    expect(out.sh).toBe(20 * 2 + 6 * 2 * 2);
  });

  it("clamps sw and sh to the image bounds from the clamped origin", () => {
    // element near the bottom-right corner; padding would overflow the image
    const r = { left: 630, top: 390, width: 20, height: 10 };
    const out = cropRect(r, 2, img, 6);
    expect(out.sx).toBe(630 * 2 - 12);
    expect(out.sy).toBe(390 * 2 - 12);
    // sw clamped so sx + sw never exceeds img.width
    expect(out.sx + out.sw).toBeLessThanOrEqual(img.width);
    expect(out.sy + out.sh).toBeLessThanOrEqual(img.height);
  });

  it("defaults dpr to 1 behavior when dpr is 1", () => {
    const r = { left: 10, top: 10, width: 100, height: 100 };
    const out = cropRect(r, 1, img, 6);
    expect(out.sx).toBe(4);
    expect(out.sy).toBe(4);
    expect(out.sw).toBe(112);
    expect(out.sh).toBe(112);
  });
});
