import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
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

export interface UrlReport {
  url: string;
  score: Score;
  findings: Finding[];
  axe: {
    violations: number;
    details: Array<{ id: string; impact: string | null; nodes: number; help: string }>;
  };
  lighthouse: LighthouseScores;
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
    },
    elements,
  };
}

// Render a URL, run the engine, axe-core, and Lighthouse.
export async function renderAndAnalyze(url: string): Promise<UrlReport> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    const captured = await page.evaluate(captureInPage);

    const findings: Finding[] = [...analyzePage(captured.page)];
    for (const snap of captured.elements) findings.push(...analyzeElement(snap));

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
      page: captured.page,
      elementsAnalyzed: captured.elements.length,
    };
  } finally {
    await browser.close();
  }
}
