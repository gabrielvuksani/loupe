// Serializable element description captured by the content script and analyzed
// by the engine. A DOM-free engine keeps every rule a pure function.
export interface ElementStyles {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  lineHeight?: string;
  padding?: string;
  margin?: string;
  borderRadius?: string;
  display?: string;
}

// Accessibility node: the role and accessible name a screen reader would announce.
export interface A11yNode {
  role: string;
  name: string;
  state?: string;
}

// Where the element comes from in source, when a dev build exposes it.
export interface SourceLocation {
  file: string;
  line?: number;
}

export interface ElementSnapshot {
  selector: string;
  // A full, unambiguous path (nth-of-type segments) so even a weak model can
  // target this exact element, not just the first match of a short selector.
  uniqueSelector?: string;
  tag: string;
  text?: string;
  styles: ElementStyles;
  // Viewport geometry: x/y locate the element, width/height size it.
  box?: { x?: number; y?: number; width: number; height: number };
  outerHTML?: string;
  a11y?: A11yNode;
  // Containment path from meaningful ancestors down to the element, so a model
  // sees where it sits in the page, not just a selector to match.
  ancestors?: Array<{ tag: string; id?: string; cls?: string; role?: string }>;
  // Position among same-tag siblings (1-based): the 2nd of 3 <a>, say.
  nth?: { index: number; total: number };
  // Identifying attributes (id, data-testid, name, type, href, aria-label, ...).
  attrs?: Record<string, string>;
  // The authored tabindex attribute, when present (not the default IDL value).
  tabIndex?: number;
  source?: SourceLocation;
  screenshot?: string;
}

// Page-wide design signals for the taste rules.
export interface PageSnapshot {
  url?: string;
  fontFamilies: string[];
  fontSizesPx: number[];
  fontWeights: number[];
  textColors: string[];
  spacings: number[];
  // Each text or background color and how many elements use it. Optional so
  // callers that build a snapshot by hand stay valid; the proportion rules skip
  // when it is absent.
  colorUsage?: Array<{ color: string; count: number }>;
}

export type FindingCategory = "a11y" | "taste" | "cross-browser" | "responsive";
export type Severity = "high" | "medium" | "low";

export interface ComputedFix {
  property: string;
  from: string;
  to: string;
  rationale: string;
  alternative?: { to: string; rationale: string };
}

export interface Finding {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  selector: string;
  message: string;
  fix?: ComputedFix;
}
