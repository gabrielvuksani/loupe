import type { ElementSnapshot, ElementStyles, Finding } from "./types";
import { contrastRatio, minimalAccessibleColor } from "./contrast";

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3;
const MIN_TARGET_PX = 44;
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);

// Element-level rules: contrast and target size.
export function analyzeElement(snapshot: ElementSnapshot): Finding[] {
  const findings: Finding[] = [];
  const { color, backgroundColor } = snapshot.styles;

  if (color && backgroundColor) {
    const ratio = contrastRatio(color, backgroundColor);
    const min = isLargeText(snapshot.styles) ? WCAG_AA_LARGE : WCAG_AA_NORMAL;
    if (ratio !== null && ratio < min) {
      const finding: Finding = {
        ruleId: "contrast",
        category: "a11y",
        severity: ratio < 3 ? "high" : "medium",
        selector: snapshot.selector,
        message: `Text contrast ${ratio.toFixed(2)}:1 is below the WCAG AA minimum of ${min}:1.`,
      };
      const fixedColor = minimalAccessibleColor(color, backgroundColor, min);
      if (fixedColor) {
        finding.fix = {
          property: "color",
          from: color,
          to: fixedColor,
          rationale: `Shift the text color to reach the ${min}:1 AA minimum.`,
        };
      }
      findings.push(finding);
    }
  }

  // target-size: interactive elements must be reliably tappable.
  if (snapshot.box && INTERACTIVE_TAGS.has(snapshot.tag)) {
    const { width, height } = snapshot.box;
    const shortest = Math.min(width, height);
    if (shortest < MIN_TARGET_PX) {
      const dim = height < MIN_TARGET_PX ? "min-height" : "min-width";
      const current = dim === "min-height" ? height : width;
      findings.push({
        ruleId: "target-size",
        category: "a11y",
        severity: shortest < 24 ? "high" : "medium",
        selector: snapshot.selector,
        message: `Touch target ${Math.round(shortest)}px is below the ${MIN_TARGET_PX}px recommended minimum for reliable tapping.`,
        fix: {
          property: dim,
          from: `${Math.round(current)}px`,
          to: `${MIN_TARGET_PX}px`,
          rationale: `Grow the target to at least ${MIN_TARGET_PX}px so it's reliably tappable.`,
        },
      });
    }
  }

  return findings;
}

/** WCAG "large text": ≥24px, or ≥18.66px when bold. */
function isLargeText(styles: ElementStyles): boolean {
  const px = Number.parseFloat(styles.fontSize ?? "");
  if (!Number.isFinite(px)) return false;
  const weight = Number(styles.fontWeight ?? "400");
  const bold = Number.isFinite(weight) ? weight >= 700 : false;
  return px >= 24 || (bold && px >= 18.66);
}
