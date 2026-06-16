import type { Finding, FindingCategory, Severity } from "./types";

const WEIGHT: Record<Severity, number> = { high: 12, medium: 7, low: 3 };
const CATEGORIES: readonly FindingCategory[] = ["a11y", "taste", "cross-browser"];

export interface Score {
  overall: number;
  byCategory: Record<FindingCategory, number>;
}

// Score: 100 minus severity-weighted deductions, clamped to 0 to 100.
export function scoreFindings(findings: readonly Finding[]): Score {
  const clamp = (n: number): number => Math.max(0, Math.min(100, n));
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const deduct = (subset: readonly Finding[]): number =>
    sum(subset.map((f) => WEIGHT[f.severity]));

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, clamp(100 - deduct(findings.filter((f) => f.category === c)))]),
  ) as Record<FindingCategory, number>;

  return { overall: clamp(100 - deduct(findings)), byCategory };
}
