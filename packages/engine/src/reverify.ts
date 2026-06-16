import type { ComputedFix, ElementSnapshot, Finding } from "./types";
import { analyzeElement } from "./analyze";
import { scoreFindings, type Score } from "./score";

export interface ReverifyResult {
  before: Finding[];
  after: Finding[];
  beforeScore: Score;
  afterScore: Score;
  appliedFixes: ComputedFix[];
  fixed: ElementSnapshot;
}

// Analyze, apply the element's own computed fixes to a new snapshot, re-analyze.
// The deterministic half of the loop: no DOM, no agent.
export function reverifyElement(snapshot: ElementSnapshot): ReverifyResult {
  const before = analyzeElement(snapshot);
  const appliedFixes = before
    .map((f) => f.fix)
    .filter((x): x is ComputedFix => x !== undefined);
  const fixed = appliedFixes.reduce(applyFix, snapshot);
  const after = analyzeElement(fixed);
  return {
    before,
    after,
    beforeScore: scoreFindings(before),
    afterScore: scoreFindings(after),
    appliedFixes,
    fixed,
  };
}

// Apply one computed fix to a snapshot, returning a new snapshot.
export function applyFix(snapshot: ElementSnapshot, fix: ComputedFix): ElementSnapshot {
  const px = Number.parseFloat(fix.to);
  const withStyle = (patch: Partial<ElementSnapshot["styles"]>): ElementSnapshot => ({
    ...snapshot,
    styles: { ...snapshot.styles, ...patch },
  });
  switch (fix.property) {
    case "color":
      return withStyle({ color: fix.to });
    case "background-color":
      return withStyle({ backgroundColor: fix.to });
    case "font-size":
      return withStyle({ fontSize: fix.to });
    case "font-weight":
      return withStyle({ fontWeight: fix.to });
    case "min-height":
      return snapshot.box
        ? { ...snapshot, box: { ...snapshot.box, height: Math.max(snapshot.box.height, px) } }
        : snapshot;
    case "min-width":
      return snapshot.box
        ? { ...snapshot, box: { ...snapshot.box, width: Math.max(snapshot.box.width, px) } }
        : snapshot;
    default:
      return snapshot;
  }
}
