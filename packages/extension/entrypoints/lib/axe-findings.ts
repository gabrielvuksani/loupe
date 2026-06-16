import type { Finding, Severity } from "@goldeye/engine";

// The subset of an axe-core violation we map. Keeps the mapper pure and testable
// without pulling in the axe runtime.
export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: string[] }>;
}

const SEVERITY: Record<string, Severity> = {
  critical: "high",
  serious: "high",
  moderate: "medium",
  minor: "low",
};

// Map axe-core violations into goldeye findings so Standalone merges real a11y
// results with the deterministic engine.
export function axeViolationsToFindings(violations: readonly AxeViolation[]): Finding[] {
  return violations.map((v) => ({
    ruleId: `axe:${v.id}`,
    category: "a11y" as const,
    severity: SEVERITY[v.impact ?? "minor"] ?? "low",
    selector: v.nodes[0]?.target[0] ?? ":root",
    message: v.help,
  }));
}
