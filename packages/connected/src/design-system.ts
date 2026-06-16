import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DesignSystem } from "@loupe/engine";

// Load the project's authored tokens from loupe.tokens.json at the given root.
// Returns null when the file is absent, unreadable, or declares nothing usable,
// so the design-system check stays silent unless the project opted in. Each
// field is validated, so a malformed file degrades to null rather than throwing.
export function loadDesignSystem(root: string): DesignSystem | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, "loupe.tokens.json"), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const system: DesignSystem = {};

  const nums = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length > 0) : [];

  const fontSizes = nums(r["fontSizes"]);
  if (fontSizes.length) system.fontSizes = fontSizes;
  const colors = strs(r["colors"]);
  if (colors.length) system.colors = colors;
  const spacing = nums(r["spacing"]);
  if (spacing.length) system.spacing = spacing;

  return system.fontSizes || system.colors || system.spacing ? system : null;
}
