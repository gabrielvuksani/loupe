import type { ElementSnapshot, PageSnapshot } from "./types";

// DOM to snapshot adapters. Browser only; never called in Node.

export function captureElement(el: Element): ElementSnapshot {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const text = (el.textContent ?? "").trim().slice(0, 120);
  const snapshot: ElementSnapshot = {
    selector: cssPath(el),
    uniqueSelector: uniquePath(el),
    tag: el.tagName.toLowerCase(),
    styles: {
      color: cs.color,
      backgroundColor: resolveBackground(el),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      display: cs.display,
    },
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
  if (text) snapshot.text = text;
  return snapshot;
}

export function capturePage(doc: Document): PageSnapshot {
  const fontFamilies = new Set<string>();
  const fontSizesPx: number[] = [];
  const fontWeights = new Set<number>();
  const textColors = new Set<string>();
  const spacings = new Set<number>();
  const colorCount = new Map<string, number>();
  const bump = (c: string): void => {
    if (c && c !== "transparent" && !/rgba?\([^)]*,\s*0\s*\)/.test(c)) {
      colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
    }
  };

  for (const el of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
    if (!el.textContent || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    if (fam) fontFamilies.add(fam);
    const fs = Number.parseFloat(cs.fontSize);
    if (Number.isFinite(fs)) fontSizesPx.push(Math.round(fs));
    const fw = Number(cs.fontWeight);
    if (Number.isFinite(fw)) fontWeights.add(fw);
    textColors.add(cs.color);
    bump(cs.color);
    bump(cs.backgroundColor);
    for (const v of [cs.marginTop, cs.paddingTop, cs.columnGap]) {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) spacings.add(Math.round(n));
    }
  }

  const snap: PageSnapshot = {
    fontFamilies: [...fontFamilies],
    fontSizesPx,
    fontWeights: [...fontWeights],
    textColors: [...textColors],
    spacings: [...spacings],
    colorUsage: [...colorCount].map(([color, count]) => ({ color, count })),
  };
  const href = doc.location?.href;
  if (href) snap.url = href;
  return snap;
}

// Walk ancestors until a non-transparent background, default white.
function resolveBackground(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && !/rgba?\([^)]*,\s*0\s*\)/.test(bg) && bg !== "transparent") return bg;
    node = node.parentElement;
  }
  return "rgb(255, 255, 255)";
}

// A full, unambiguous path (nth-of-type at each level, stopping at an id or six
// levels up) so an agent can target this exact element rather than the first
// match of a short selector.
function uniquePath(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 6) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
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
}

// A short CSS selector for an element.
function cssPath(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList)[0];
  const base = cls ? `${tag}.${cls}` : tag;
  const parent = el.parentElement;
  if (!parent) return base;
  const sibs = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sibs.length > 1) return `${base}:nth-of-type(${sibs.indexOf(el) + 1})`;
  return base;
}
