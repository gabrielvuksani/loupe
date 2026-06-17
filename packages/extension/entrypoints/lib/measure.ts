// Pure spacing geometry for the two-element measure (VisBug: hold Shift, hover a
// second element). DOM-free so it is unit-testable: the content script reads the
// rects, this owns the math for the distance between them.

// A structural subset of DOMRect: the four edges.
export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Edge-to-edge distance between two arbitrary boxes: the horizontal gap when they
// do not overlap horizontally, the vertical gap when they do not overlap
// vertically. Both undefined means they overlap on both axes (no clean gap).
export function betweenGaps(a: Box, b: Box): { dx?: number; dy?: number } {
  const out: { dx?: number; dy?: number } = {};
  if (b.left >= a.right) out.dx = b.left - a.right;
  else if (a.left >= b.right) out.dx = a.left - b.right;
  if (b.top >= a.bottom) out.dy = b.top - a.bottom;
  else if (a.top >= b.bottom) out.dy = a.top - b.bottom;
  return out;
}
