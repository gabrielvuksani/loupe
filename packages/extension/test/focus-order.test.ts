import { describe, it, expect } from "vitest";
import { focusOrder } from "../entrypoints/lib/focus-order";

describe("focusOrder", () => {
  it("puts positive tabindex first, ascending, before the natural order", () => {
    // dom0 natural, dom1 tabindex 2, dom2 tabindex 1 -> 1 then 2 then natural
    const out = focusOrder([
      { tabindex: 0, dom: 0 },
      { tabindex: 2, dom: 1 },
      { tabindex: 1, dom: 2 },
    ]);
    expect(out.map((n) => n.dom)).toEqual([2, 1, 0]);
  });

  it("breaks positive-tabindex ties by DOM order", () => {
    const out = focusOrder([
      { tabindex: 1, dom: 5 },
      { tabindex: 1, dom: 2 },
    ]);
    expect(out.map((n) => n.dom)).toEqual([2, 5]);
  });

  it("excludes negative tabindex (not in the tab sequence)", () => {
    const out = focusOrder([
      { tabindex: -1, dom: 0 },
      { tabindex: 0, dom: 1 },
    ]);
    expect(out.map((n) => n.dom)).toEqual([1]);
  });

  it("keeps DOM order for tabindex 0 / absent", () => {
    const out = focusOrder([
      { tabindex: 0, dom: 3 },
      { tabindex: 0, dom: 1 },
      { tabindex: 0, dom: 2 },
    ]);
    expect(out.map((n) => n.dom)).toEqual([1, 2, 3]);
  });
});
