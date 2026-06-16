import type { Finding } from "./types";

// One element's computed indicators in its resting state versus while it is
// keyboard-focused. The connected adapter gathers these by tabbing through the
// page, so :focus-visible matches the way it would for a real keyboard user.
export interface FocusProbe {
  selector: string;
  focusOutlineStyle: string; // "none" when there is no outline
  focusOutlineWidth: string; // e.g. "0px" or "2px"
  baseShadow: string;
  focusShadow: string;
  baseBorder: string;
  focusBorder: string;
}

// focus-visible: a keyboard user must be able to see which control is focused
// (WCAG 2.4.7). We flag only the unambiguous failure, where focus draws no
// outline AND changes neither the box-shadow nor the border, so a control with
// any focus ring at all passes. No computed fix: the remedy (an outline, a ring,
// a border) is a design choice, so loupe names the gap and leaves it to the agent.
export function focusFindings(probes: readonly FocusProbe[]): Finding[] {
  const findings: Finding[] = [];
  for (const p of probes) {
    const hasOutline = p.focusOutlineStyle !== "none" && Number.parseFloat(p.focusOutlineWidth) > 0;
    const shadowChanged = p.focusShadow !== p.baseShadow;
    const borderChanged = p.focusBorder !== p.baseBorder;
    if (!hasOutline && !shadowChanged && !borderChanged) {
      findings.push({
        ruleId: "focus-visible",
        category: "a11y",
        severity: "medium",
        selector: p.selector,
        message: `${p.selector} shows no visible focus indicator when keyboard-focused. Add an outline or a ring on :focus-visible so keyboard users can see where they are.`,
      });
    }
  }
  return findings;
}
