import bcd from "@mdn/browser-compat-data" with { type: "json" };
import browserslist from "browserslist";
import type { Finding } from "@goldeye/engine";

// CSS property compat lives under bcd.css.properties[name].__compat.support.
// Typed loosely: the JSON is enormous and we only read a narrow slice.
type SupportStatement = { version_added?: string | boolean | null } | Array<{ version_added?: string | boolean | null }>;
type Compat = { __compat?: { support?: Record<string, SupportStatement> } };
// BCD ships a deep, recursive Identifier type; cast the narrow slice we read
// through unknown rather than fighting it.
const cssProperties = (bcd as unknown as { css: { properties: Record<string, Compat> } }).css.properties;

// browserslist names differ from BCD keys. Map the ones with a clean
// equivalent; anything absent here (kaios, op_mini, and_qq, and_uc) is dropped
// rather than guessed, so we under-report instead of emitting false positives.
const NAME_TO_BCD: Record<string, string> = {
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
  safari: "safari",
  opera: "opera",
  ie: "ie",
  ios_saf: "safari_ios",
  and_chr: "chrome_android",
  and_ff: "firefox_android",
  op_mob: "opera_android",
  samsung: "samsunginternet_android",
  android: "webview_android",
};

// Resolve a browserslist name to its BCD support key, or undefined when there
// is no faithful mapping.
export function bcdBrowser(name: string): string | undefined {
  return NAME_TO_BCD[name];
}

// The default browserslist query as concrete "<browser> <version>" tokens.
export function resolveTargets(query?: string | readonly string[]): string[] {
  return browserslist(query as string | string[] | undefined);
}

// Pick the first support statement (BCD sometimes stores an array, newest first).
function firstStatement(s: SupportStatement | undefined): { version_added?: string | boolean | null } | undefined {
  if (!s) return undefined;
  return Array.isArray(s) ? s[0] : s;
}

// A target lacks a property when BCD records version_added === false. A version
// string or true counts as supported; missing data is treated as supported so
// we never flag on absence of evidence.
function lacksSupport(property: string, bcdKey: string): boolean {
  const stmt = firstStatement(cssProperties[property]?.__compat?.support?.[bcdKey]);
  return stmt?.version_added === false;
}

// Pure, unit-testable core: for each used property, emit at most one
// cross-browser Finding naming the target browsers that lack support.
export function crossBrowserFindings(usedProperties: readonly string[], targets: readonly string[]): Finding[] {
  const findings: Finding[] = [];

  for (const property of usedProperties) {
    if (!cssProperties[property]?.__compat) continue; // unknown / custom property

    const missing: string[] = [];
    for (const target of targets) {
      const name = target.split(" ")[0];
      if (!name) continue;
      const bcdKey = bcdBrowser(name);
      if (!bcdKey) continue;
      if (lacksSupport(property, bcdKey)) missing.push(target);
    }
    if (missing.length === 0) continue;

    // Several missing targets is a broader gap, so it reads as medium.
    const severity = missing.length > 1 ? "medium" : "low";
    findings.push({
      ruleId: "cross-browser",
      category: "cross-browser",
      severity,
      selector: `css-property:${property}`,
      message: `CSS property '${property}' is unsupported in ${missing.join(", ")}.`,
    });
  }

  return findings;
}

// Convenience for callers that have the rendered CSS already concatenated.
// Kept thin: the heavy css-analyzer import lives in the adapter, not here, so
// this module stays trivially testable without parsing real CSS.
export interface CrossBrowserSummary {
  targets: string[];
  propertiesChecked: number;
  findings: Finding[];
}
