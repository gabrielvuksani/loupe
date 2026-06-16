import { chromium, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { analyze as analyzeCss } from "@projectwallace/css-analyzer";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import {
  analyzeElement,
  analyzePage,
  scoreFindings,
  type ElementSnapshot,
  type Finding,
  type PageSnapshot,
  type Score,
} from "@goldeye/engine";
import { runLighthouse, type LighthouseScores } from "./lighthouse-adapter";
import { crossBrowserFindings, resolveTargets, type CrossBrowserSummary } from "./cross-browser";

export interface UrlReport {
  url: string;
  score: Score;
  findings: Finding[];
  axe: {
    violations: number;
    details: Array<{ id: string; impact: string | null; nodes: number; help: string }>;
  };
  lighthouse: LighthouseScores;
  crossBrowser: CrossBrowserSummary;
  page: PageSnapshot;
  elementsAnalyzed: number;
}

// Self-contained DOM capture, injected via evaluate().
function captureInPage(): { page: PageSnapshot; elements: ElementSnapshot[] } {
  const resolveBg = (el: Element): string => {
    let n: Element | null = el;
    while (n) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "transparent" && !/,\s*0\s*\)\s*$/.test(bg)) return bg;
      n = n.parentElement;
    }
    return "rgb(255, 255, 255)";
  };
  const path = (el: Element): string => {
    const he = el as HTMLElement;
    if (he.id) return `#${he.id}`;
    const tag = el.tagName.toLowerCase();
    const c = el.classList[0];
    return c ? `${tag}.${c}` : tag;
  };

  const fams = new Set<string>();
  const weights = new Set<number>();
  const colors = new Set<string>();
  const spac = new Set<number>();
  const sizes: number[] = [];
  const elements: ElementSnapshot[] = [];
  const colorCount = new Map<string, number>();
  const bumpColor = (c: string): void => {
    if (c && c !== "transparent" && !/rgba?\([^)]*,\s*0\s*\)/.test(c)) {
      colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
    }
  };

  for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const txt = (el.textContent ?? "").trim();
    const cs = getComputedStyle(el);
    if (txt) {
      const fam = cs.fontFamily.split(",")[0]?.trim().replace(/["']/g, "");
      if (fam) fams.add(fam);
      const fs = Number.parseFloat(cs.fontSize);
      if (Number.isFinite(fs)) sizes.push(Math.round(fs));
      const fw = Number(cs.fontWeight);
      if (Number.isFinite(fw)) weights.add(fw);
      colors.add(cs.color);
      bumpColor(cs.color);
      bumpColor(cs.backgroundColor);
      for (const v of [cs.marginTop, cs.paddingTop, cs.columnGap]) {
        const n = Number.parseFloat(v);
        if (Number.isFinite(n) && n > 0) spac.add(Math.round(n));
      }
    }
    const tag = el.tagName.toLowerCase();
    const interactive = ["button", "a", "input", "select", "textarea"].includes(tag);
    const isTextLeaf = Boolean(txt) && el.children.length === 0;
    if ((interactive || isTextLeaf) && elements.length < 80) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const snap: ElementSnapshot = {
        selector: path(el),
        tag,
        styles: {
          color: cs.color,
          backgroundColor: resolveBg(el),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        },
        box: { width: r.width, height: r.height },
      };
      if (txt) snap.text = txt.slice(0, 120);
      elements.push(snap);
    }
  }

  return {
    page: {
      url: location.href,
      fontFamilies: [...fams],
      fontSizesPx: sizes,
      fontWeights: [...weights],
      textColors: [...colors],
      spacings: [...spac],
      colorUsage: [...colorCount].map(([color, count]) => ({ color, count })),
    },
    elements,
  };
}

function engineFindings(captured: { page: PageSnapshot; elements: ElementSnapshot[] }): Finding[] {
  const findings: Finding[] = [...analyzePage(captured.page)];
  for (const snap of captured.elements) findings.push(...analyzeElement(snap));
  return findings;
}

// Concatenate every same-origin stylesheet's text. Cross-origin sheets throw on
// .cssRules access, so each is guarded and skipped.
function collectCssInPage(): string {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + "\n";
    } catch {
      // cross-origin sheet: not readable, skip it
    }
  }
  return css;
}

// css-analyzer + the pure cross-browser rule. The heavy parse lives here in
// connected; the rule itself stays pure in cross-browser.ts.
function analyzeCrossBrowser(css: string): CrossBrowserSummary {
  const targets = resolveTargets();
  let used: string[] = [];
  try {
    const result = analyzeCss(css);
    used = Object.keys(result.properties.unique);
  } catch {
    used = [];
  }
  return {
    targets,
    propertiesChecked: used.length,
    findings: crossBrowserFindings(used, targets),
  };
}

export interface AppliedFix {
  selector: string;
  property: string;
  to: string;
}

export interface VisualDelta {
  changedPixels: number;
  ratio: number;
}

export interface ReverifyReport {
  url: string;
  before: { findings: Finding[]; score: Score };
  after: { findings: Finding[]; score: Score };
  applied: AppliedFix[];
  visualDelta: VisualDelta;
}

// Decode two PNG buffers and pixel-diff them. On any dimension mismatch the
// images are not comparable, so we report a full delta (ratio 1) rather than
// throwing. Pure over buffers, so it is unit-testable without a browser.
export function visualDelta(beforePng: Buffer, afterPng: Buffer): VisualDelta {
  const a = PNG.sync.read(beforePng);
  const b = PNG.sync.read(afterPng);
  if (a.width !== b.width || a.height !== b.height) {
    const total = Math.max(a.width * a.height, b.width * b.height) || 1;
    return { changedPixels: total, ratio: 1 };
  }
  const total = a.width * a.height;
  const changedPixels = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
  return { changedPixels, ratio: total === 0 ? 0 : changedPixels / total };
}

// Full-page PNG screenshot of the current DOM state.
function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: "png" });
}

// The loop on a real render: judge, apply the computed fixes to the live DOM,
// re-judge. When fixes are omitted they are derived from the first analysis.
export async function reverifyAfterFix(url: string, fixes?: AppliedFix[]): Promise<ReverifyReport> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    const beforeCap = await page.evaluate(captureInPage);
    const beforeFindings = engineFindings(beforeCap);
    const beforeShot = await screenshot(page);

    const applied: AppliedFix[] =
      fixes ??
      beforeFindings.flatMap((f) =>
        f.fix ? [{ selector: f.selector, property: f.fix.property, to: f.fix.to }] : [],
      );

    await page.evaluate((toApply: AppliedFix[]) => {
      for (const fx of toApply) {
        const el = document.querySelector(fx.selector) as HTMLElement | null;
        if (el) el.style.setProperty(fx.property, fx.to);
      }
    }, applied);

    const afterCap = await page.evaluate(captureInPage);
    const afterFindings = engineFindings(afterCap);
    const afterShot = await screenshot(page);

    return {
      url,
      before: { findings: beforeFindings, score: scoreFindings(beforeFindings) },
      after: { findings: afterFindings, score: scoreFindings(afterFindings) },
      applied,
      visualDelta: visualDelta(beforeShot, afterShot),
    };
  } finally {
    await browser.close();
  }
}

// Render a URL, run the engine, axe-core, and Lighthouse.
export async function renderAndAnalyze(url: string): Promise<UrlReport> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    const captured = await page.evaluate(captureInPage);

    const css = await page.evaluate(collectCssInPage);
    const crossBrowser = analyzeCrossBrowser(css);

    // cross-browser findings join the engine findings so the score reflects them.
    const findings = [...engineFindings(captured), ...crossBrowser.findings];

    let axeViolations: Array<{ id: string; impact: string | null; nodes: unknown[]; help: string }> = [];
    try {
      const res = await new AxeBuilder({ page }).analyze();
      axeViolations = res.violations as typeof axeViolations;
    } catch {
      axeViolations = [];
    }

    const lighthouse = await runLighthouse(url);

    return {
      url,
      score: scoreFindings(findings),
      findings,
      axe: {
        violations: axeViolations.length,
        details: axeViolations.slice(0, 10).map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          nodes: v.nodes.length,
          help: v.help,
        })),
      },
      lighthouse,
      crossBrowser,
      page: captured.page,
      elementsAnalyzed: captured.elements.length,
    };
  } finally {
    await browser.close();
  }
}
