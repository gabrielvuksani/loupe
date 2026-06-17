// Pure spacing geometry for the VisBug-style guides. DOM-free so it is
// unit-testable: the content script reads the rects, this owns the math that
// decides which neighbor counts and how far away it is.

// A structural subset of DOMRect: the four edges.
export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Gaps {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

// The nearest-neighbor gap in each direction, counting only candidates that
// overlap the target on the perpendicular axis, so a box to the right that sits
// far above is not a "right neighbor". Boxes that overlap or contain the target
// produce no gap in that direction.
export function nearestGaps(target: Box, candidates: readonly Box[]): Gaps {
  const gaps: Gaps = {};
  const vOverlap = (c: Box): boolean => c.top < target.bottom && c.bottom > target.top;
  const hOverlap = (c: Box): boolean => c.left < target.right && c.right > target.left;
  const closer = (dir: keyof Gaps, g: number): void => {
    if (g >= 0 && (gaps[dir] === undefined || g < (gaps[dir] as number))) gaps[dir] = g;
  };
  for (const c of candidates) {
    if (c.left >= target.right && vOverlap(c)) closer("right", c.left - target.right);
    if (c.right <= target.left && vOverlap(c)) closer("left", target.left - c.right);
    if (c.top >= target.bottom && hOverlap(c)) closer("bottom", c.top - target.bottom);
    if (c.bottom <= target.top && hOverlap(c)) closer("top", target.top - c.bottom);
  }
  return gaps;
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
