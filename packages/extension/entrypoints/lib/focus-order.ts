// Pure tab-order sort for the focus-order overlay. DOM-free so it is testable:
// the content script collects the focusable nodes and their tabindex, this owns
// the rule for what order the keyboard actually visits them in.

export interface FocusNode {
  // The authored tabindex (0 when absent-but-focusable, negative when removed).
  tabindex: number;
  // The element's position in document order, used as the tiebreaker.
  dom: number;
}

// Tab order: elements with a positive tabindex come first, ascending by tabindex
// (ties broken by DOM order), then the natural order (tabindex 0 or absent) in
// DOM order. Negative tabindex is not in the sequence at all.
export function focusOrder<T extends FocusNode>(nodes: readonly T[]): T[] {
  return nodes
    .filter((n) => n.tabindex >= 0)
    .slice()
    .sort((a, b) => {
      const ap = a.tabindex > 0;
      const bp = b.tabindex > 0;
      if (ap && bp) return a.tabindex - b.tabindex || a.dom - b.dom;
      if (ap !== bp) return ap ? -1 : 1;
      return a.dom - b.dom;
    });
}
