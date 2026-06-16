import type { ComputedFix, ElementSnapshot, ElementStyles, Finding } from "./types";
import { contrastRatio, minimalAccessibleColor, alternativeAccessibleColor, apcaContrast } from "./contrast";

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3;
const MIN_TARGET_PX = 44;
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);
const MAX_CPL = 75; // Refactoring UI: comfortable line length is 45 to 75 characters.
const MIN_WRAPPING_TEXT = 60; // Below this the text cannot fill a wide line, so skip.
const AVG_GLYPH_RATIO = 0.5; // Mean glyph advance approximated as half the font size.
const GENERIC_TAGS = new Set(["div", "span"]);
const SEMANTIC_FOR_ROLE: Record<string, string> = { button: "<button>", link: "<a>" };

// Element-level rules: contrast and target size.
export function analyzeElement(snapshot: ElementSnapshot): Finding[] {
  const findings: Finding[] = [];
  const { color, backgroundColor } = snapshot.styles;

  if (color && backgroundColor) {
    const ratio = contrastRatio(color, backgroundColor);
    const min = isLargeText(snapshot.styles) ? WCAG_AA_LARGE : WCAG_AA_NORMAL;
    if (ratio !== null && ratio < min) {
      const lc = apcaContrast(color, backgroundColor);
      const apcaNote = lc !== null ? ` (APCA Lc ${lc})` : "";
      const finding: Finding = {
        ruleId: "contrast",
        category: "a11y",
        severity: ratio < 3 ? "high" : "medium",
        selector: snapshot.selector,
        message: `Text contrast ${ratio.toFixed(2)}:1 is below the WCAG AA minimum of ${min}:1${apcaNote}.`,
      };
      const fixedColor = minimalAccessibleColor(color, backgroundColor, min);
      if (fixedColor) {
        const fix: ComputedFix = {
          property: "color",
          from: color,
          to: fixedColor,
          rationale: `Shift the text color to reach the ${min}:1 AA minimum, preserving the hue.`,
        };
        const alt = alternativeAccessibleColor(color, backgroundColor, min);
        if (alt && alt !== fixedColor) {
          fix.alternative = { to: alt, rationale: "Simpler blend toward black or white, less saturated." };
        }
        finding.fix = fix;
      }
      findings.push(finding);
    }
  }

  // target-size: interactive elements must be reliably tappable. WCAG 2.5.5
  // exempts inline targets (a link within a sentence), so an <a> rendered inline
  // is treated as text, not a discrete tap target held to 44px.
  const inlineLink = snapshot.tag === "a" && snapshot.styles.display === "inline";
  if (snapshot.box && INTERACTIVE_TAGS.has(snapshot.tag) && !inlineLink) {
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

  // semantic-tag: a generic element wearing an interactive role should be the real element.
  const role = snapshot.a11y?.role;
  if (role && GENERIC_TAGS.has(snapshot.tag)) {
    const semantic = SEMANTIC_FOR_ROLE[role];
    if (semantic) {
      findings.push({
        ruleId: "semantic-tag",
        category: "a11y",
        severity: "medium",
        selector: snapshot.selector,
        message: `<${snapshot.tag}> exposes the ${role} role. Use a real ${semantic} element for built-in keyboard and focus behavior.`,
      });
    }
  }

  // tabindex-order: a positive tabindex forces a manual tab order that diverges
  // from the DOM and breaks as the page changes. 0 or absent is correct; a
  // negative value is left alone (legitimate for roving tabindex and
  // programmatic focus). The remedy is an attribute change, so no CSS fix is
  // attached; the message carries the exact instruction.
  if (snapshot.tabIndex !== undefined && snapshot.tabIndex > 0) {
    findings.push({
      ruleId: "tabindex-order",
      category: "a11y",
      severity: "medium",
      selector: snapshot.selector,
      message: `tabindex="${snapshot.tabIndex}" forces a manual tab order that fights the DOM and breaks as the page changes. Use tabindex="0" to join the natural order, or remove it.`,
    });
  }

  // line-length: body text past ~75 characters per line is tiring to read.
  if (snapshot.text && snapshot.text.length >= MIN_WRAPPING_TEXT && snapshot.box) {
    const px = Number.parseFloat(snapshot.styles.fontSize ?? "");
    const width = snapshot.box.width;
    if (Number.isFinite(px) && px > 0 && width > 0) {
      const cpl = width / (px * AVG_GLYPH_RATIO);
      if (cpl > MAX_CPL) {
        findings.push({
          ruleId: "line-length",
          category: "taste",
          severity: "low",
          selector: snapshot.selector,
          message: `Line length is about ${Math.round(cpl)} characters, past the comfortable 45 to 75 range. Narrow the measure.`,
        });
      }
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
