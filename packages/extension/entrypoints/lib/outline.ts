// Pure heading-structure logic for the outline view. DOM-free so it is testable:
// the content script collects the heading levels + text, this owns the rule for
// what counts as a skipped level and whether the page is missing its h1.

export interface Heading {
  level: number;
  text: string;
}

export interface OutlineEntry extends Heading {
  // True when this heading jumps more than one level deeper than the previous
  // heading (e.g. h1 straight to h3), which breaks the document structure.
  skipped: boolean;
}

export interface Outline {
  entries: OutlineEntry[];
  noH1: boolean;
}

export function buildOutline(headings: readonly Heading[]): Outline {
  let prev = 0;
  const entries = headings.map((h) => {
    const skipped = prev > 0 && h.level > prev + 1;
    prev = h.level;
    return { level: h.level, text: h.text, skipped };
  });
  const noH1 = headings.length > 0 && !headings.some((h) => h.level === 1);
  return { entries, noH1 };
}
