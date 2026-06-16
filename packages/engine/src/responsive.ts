import type { Finding } from "./types";

// One viewport probe: the rendered document width and the elements that spill
// past the right edge. The connected adapter gathers these at each width.
export interface ViewportProbe {
  width: number;
  documentWidth: number;
  overflow: Array<{ selector: string; overflowBy: number }>;
}

// Horizontal overflow is an objective responsive bug: at this width the page
// scrolls sideways. We flag it per offending width and name the worst culprits.
// No computed fix is attached, because the root cause (a fixed width, an unbroken
// string, an unconstrained image) genuinely varies; the value is precise
// detection and a target, which the agent then resolves.
export function responsiveFindings(probes: readonly ViewportProbe[]): Finding[] {
  const findings: Finding[] = [];
  for (const p of probes) {
    const past = Math.round(p.documentWidth - p.width);
    if (past <= 1) continue; // fits, within a 1px rounding tolerance
    const worst = [...p.overflow].sort((a, b) => b.overflowBy - a.overflowBy).slice(0, 2);
    const culprits = worst.length
      ? ` Worst: ${worst.map((o) => `${o.selector} (+${Math.round(o.overflowBy)}px)`).join(", ")}.`
      : "";
    findings.push({
      ruleId: "responsive-overflow",
      category: "responsive",
      severity: past > 16 ? "high" : "medium",
      selector: worst[0]?.selector ?? ":root",
      message: `Horizontal overflow at ${p.width}px wide: the page is ${Math.round(p.documentWidth)}px, ${past}px past the viewport, so it scrolls sideways.${culprits}`,
    });
  }
  return findings;
}
