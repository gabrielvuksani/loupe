// WCAG 2.1 contrast math. Pure and dependency free.

export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();

  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) {
    const [, r, g, b] = m;
    if (r && g && b) return [Number(r), Number(g), Number(b)];
  }

  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (/^[0-9a-f]{6}$/.test(h)) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
  }

  return null;
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Contrast ratio (1 to 21). Null if either color is unparseable.
export function contrastRatio(c1: string, c2: string): number | null {
  const a = parseColor(c1);
  const b = parseColor(c2);
  if (!a || !b) return null;
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbString([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Nearest color to fg that meets the target contrast against bg, found by
// binary searching a blend toward black or white.
export function minimalAccessibleColor(
  fg: string,
  bg: string,
  target = 4.5,
): string | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;

  const passes = (c: [number, number, number]): boolean => {
    const r = contrastRatio(rgbString(c), bg);
    return r !== null && r >= target;
  };
  if (passes(f)) return rgbString(f);

  const toward: [number, number, number] =
    relativeLuminance(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];

  const mix = (
    a: [number, number, number],
    z: [number, number, number],
    t: number,
  ): [number, number, number] => [
    a[0] + (z[0] - a[0]) * t,
    a[1] + (z[1] - a[1]) * t,
    a[2] + (z[2] - a[2]) * t,
  ];

  let lo = 0;
  let hi = 1;
  let best = toward;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const c = mix(f, toward, t);
    if (passes(c)) {
      best = c;
      hi = t;
    } else {
      lo = t;
    }
  }
  return rgbString(best);
}
