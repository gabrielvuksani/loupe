import type { Finding } from "./types";

// One element's animation state, captured by the connected adapter while
// prefers-reduced-motion: reduce is emulated. DOM-free so the rule stays pure.
export interface AnimationProbe {
  selector: string;
  animationName: string; // "none" when there is no animation
  animationDuration: string; // e.g. "0s", "1.5s"
  animationIterationCount: string; // e.g. "1", "infinite"
}

// reduced-motion: an element that keeps animating forever even though the user
// asked for reduced motion (prefers-reduced-motion: reduce). We flag only the
// unambiguous case, an infinite animation with a real duration, so a one-shot
// transition that plays once and stops is left alone. The remedy is a media
// query, so no computed fix is attached. This is only meaningful on a render
// where reduced motion is actually emulated; the connected adapter runs it
// solely for those profiles, so a normal spinner is never mistaken for a fault.
export function reducedMotionFindings(probes: readonly AnimationProbe[]): Finding[] {
  const findings: Finding[] = [];
  for (const p of probes) {
    const running = p.animationName !== "none" && Number.parseFloat(p.animationDuration) > 0;
    if (running && p.animationIterationCount.trim() === "infinite") {
      findings.push({
        ruleId: "reduced-motion",
        category: "a11y",
        severity: "medium",
        selector: p.selector,
        message: `${p.selector} keeps animating ("${p.animationName}", infinite) even though the user asked for reduced motion. Gate the animation behind @media (prefers-reduced-motion: no-preference).`,
      });
    }
  }
  return findings;
}
