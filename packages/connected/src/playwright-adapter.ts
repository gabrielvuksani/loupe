import * as net from "node:net";
import * as dns from "node:dns";
import { chromium, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { analyze as analyzeCss } from "@projectwallace/css-analyzer";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import {
  analyzeElement,
  analyzePage,
  responsiveFindings,
  scoreFindings,
  type ElementSnapshot,
  type Finding,
  type PageSnapshot,
  type Score,
  type ViewportProbe,
} from "@loupe/engine";
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
  const uniquePath = (el: Element): string => {
    const he = el as HTMLElement;
    if (he.id) return `#${CSS.escape(he.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      const id = (node as HTMLElement).id;
      if (id) {
        parts.unshift(`#${CSS.escape(id)}`);
        break;
      }
      let seg = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
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
        uniqueSelector: uniquePath(el),
        tag,
        styles: {
          color: cs.color,
          backgroundColor: resolveBg(el),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          display: cs.display,
        },
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
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

// Measure horizontal overflow at the current viewport: the document width and
// the elements whose right edge spills past it. Injected via evaluate.
function probeOverflow(): { documentWidth: number; overflow: Array<{ selector: string; overflowBy: number }> } {
  const vw = window.innerWidth;
  const sel = (el: Element): string => {
    const he = el as HTMLElement;
    if (he.id) return `#${he.id}`;
    const tag = el.tagName.toLowerCase();
    const c = el.classList[0];
    return c ? `${tag}.${c}` : tag;
  };
  const overflow: Array<{ selector: string; overflowBy: number }> = [];
  for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) overflow.push({ selector: sel(el), overflowBy: r.right - vw });
  }
  return {
    documentWidth: document.documentElement.scrollWidth,
    overflow: overflow.sort((a, b) => b.overflowBy - a.overflowBy).slice(0, 10),
  };
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

// Refuse to render anything but http(s): blocks file:// and other local schemes
// an agent-supplied URL could use to reach the host machine.
function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to render a non-http(s) URL: ${url}`);
  }
}

// GCP metadata hostnames that resolve to 169.254.169.254. Blocked by name so a
// match never depends on DNS returning the link-local IP.
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

// Decode a non-dotted-quad IPv4 literal (decimal, octal, or hex integer) into a
// 32-bit address. Returns null when the string is not such a form. Mirrors the
// permissive inet_aton parsing that http stacks accept, so an encoded
// 169.254.0.0/16 address cannot slip past the dotted-quad check.
function decodeIntegerIpv4(host: string): number | null {
  const s = host.trim();
  if (s === "") return null;
  let value: number;
  if (/^0x[0-9a-f]+$/i.test(s)) value = Number.parseInt(s, 16);
  else if (/^0[0-7]+$/.test(s)) value = Number.parseInt(s, 8);
  else if (/^[1-9][0-9]*$/.test(s) || s === "0") value = Number.parseInt(s, 10);
  else return null;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value >>> 0;
}

// True for 169.254.0.0/16 given the 32-bit host order address.
function isIpv4LinkLocal(addr32: number): boolean {
  return (addr32 >>> 16) === 0xa9fe;
}

// Dotted-quad string to a 32-bit address, or null if not four 0-255 octets.
function dottedQuadTo32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let addr = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    addr = (addr << 8) | n;
  }
  return addr >>> 0;
}

// True for an address loupe must never render: IPv4 link-local 169.254.0.0/16
// (the cloud metadata range, including encoded and IPv4-mapped IPv6 forms) and
// IPv6 link-local fe80::/10. Loopback and RFC1918 are deliberately allowed: the
// legitimate render target is the user's own dev server. Pure and synchronous.
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);

  if (kind === 4) {
    const addr = dottedQuadTo32(ip);
    return addr !== null && isIpv4LinkLocal(addr);
  }

  if (kind === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d): re-check the embedded IPv4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      const addr = dottedQuadTo32(mapped[1]!);
      return addr !== null && isIpv4LinkLocal(addr);
    }
    // fe80::/10: first 10 bits are 1111111010.
    return lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }

  // Not a literal net.isIP accepts: try integer-encoded IPv4 (decimal/octal/hex).
  const encoded = decodeIntegerIpv4(ip);
  return encoded !== null && isIpv4LinkLocal(encoded);
}

// Full pre-render guard: http(s) scheme, then DNS-resolve the hostname and
// refuse if any resolved address is link-local/metadata. Resolving every
// address defeats DNS rebinding (a name that answers public once then link-local
// on the render fetch). DNS failures are not treated as blocks: the render is
// allowed to proceed and Playwright fails on its own.
export async function assertRenderableUrl(url: string): Promise<void> {
  assertHttpUrl(url);
  const host = new URL(url).hostname;

  const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (METADATA_HOSTS.has(normalizedHost)) {
    throw new Error(`Refusing to render a link-local/metadata address: ${host}`);
  }

  // A literal IP host never needs DNS; check it directly.
  if (net.isIP(normalizedHost) !== 0 && isBlockedAddress(normalizedHost)) {
    throw new Error(`Refusing to render a link-local/metadata address: ${host}`);
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await dns.promises.lookup(host, { all: true });
  } catch {
    return; // DNS failure: let the render attempt fail naturally.
  }

  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      throw new Error(`Refusing to render a link-local/metadata address: ${host} -> ${address}`);
    }
  }
}

// The loop on a real render: judge, apply the computed fixes to the live DOM,
// re-judge. When fixes are omitted they are derived from the first analysis.
export async function reverifyAfterFix(url: string, fixes?: AppliedFix[]): Promise<ReverifyReport> {
  await assertRenderableUrl(url);
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
  await assertRenderableUrl(url);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    const captured = await page.evaluate(captureInPage);

    const css = await page.evaluate(collectCssInPage);
    const crossBrowser = analyzeCrossBrowser(css);

    let axeViolations: Array<{ id: string; impact: string | null; nodes: unknown[]; help: string }> = [];
    try {
      const res = await new AxeBuilder({ page }).analyze();
      axeViolations = res.violations as typeof axeViolations;
    } catch {
      axeViolations = [];
    }

    // Responsive: re-measure horizontal overflow at a few widths, after the main
    // capture and axe so those ran at the default viewport.
    const probes: ViewportProbe[] = [];
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      probes.push({ width, ...(await page.evaluate(probeOverflow)) });
    }
    const findings = [...engineFindings(captured), ...crossBrowser.findings, ...responsiveFindings(probes)];

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
