// Pure popover placement math. DOM-free so it is unit-testable without a layout
// engine: the content script measures the element and the rendered popover, this
// owns the geometry that decides where the popover lands.

// A structural subset of DOMRect: only the edges placement needs.
export interface ElementBox {
  top: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Point {
  top: number;
  left: number;
}

// Prefer the popover just below the element; flip above when below would spill
// past the bottom; if it fits neither, pin it to the margin. Horizontally, align
// the left edges and clamp so the popover stays fully on-screen.
export function placePopover(
  el: ElementBox,
  pop: Size,
  vp: Viewport,
  margin = 8,
): Point {
  let top = el.bottom + margin;
  if (top + pop.height > vp.height - margin) {
    const above = el.top - margin - pop.height;
    top = above >= margin ? above : Math.max(margin, vp.height - margin - pop.height);
  }

  let left = el.left;
  if (left + pop.width > vp.width - margin) left = vp.width - margin - pop.width;
  if (left < margin) left = margin;

  return { top, left };
}
