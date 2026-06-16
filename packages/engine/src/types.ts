// Serializable element description captured by the content script and analyzed
// by the engine. A DOM-free engine keeps every rule a pure function.
export interface ElementStyles {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
}

export interface ElementSnapshot {
  selector: string;
  tag: string;
  text?: string;
  styles: ElementStyles;
  box?: { width: number; height: number };
}

// Page-wide design signals for the taste rules.
export interface PageSnapshot {
  url?: string;
  fontFamilies: string[];
  fontSizesPx: number[];
  fontWeights: number[];
  textColors: string[];
  spacings: number[];
}

export type FindingCategory = "a11y" | "taste" | "cross-browser";
export type Severity = "high" | "medium" | "low";

export interface ComputedFix {
  property: string;
  from: string;
  to: string;
  rationale: string;
}

export interface Finding {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  selector: string;
  message: string;
  fix?: ComputedFix;
}
