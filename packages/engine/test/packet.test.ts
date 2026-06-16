import { describe, it, expect } from "vitest";
import { analyzeElement, buildPacket, packetToMarkdown } from "../src/index";
import type { ElementSnapshot } from "../src/index";

const snapshot: ElementSnapshot = {
  selector: ".site-btn-ghost",
  tag: "button",
  text: "Watch the tour",
  styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
};

describe("buildPacket", () => {
  it("bundles the snapshot, its findings, the fixes, and an element score", () => {
    const packet = buildPacket(snapshot, analyzeElement(snapshot));
    expect(packet.selector).toBe(".site-btn-ghost");
    expect(packet.tag).toBe("button");
    expect(packet.findings.length).toBeGreaterThan(0);
    expect(packet.fixes.length).toBeGreaterThan(0);
    expect(packet.score).toBeLessThan(100);
  });
});

describe("packetToMarkdown", () => {
  it("renders an agent-pasteable packet with selector, findings, and a fix arrow", () => {
    const md = packetToMarkdown(buildPacket(snapshot, analyzeElement(snapshot)));
    expect(md).toContain(".site-btn-ghost");
    expect(md).toMatch(/contrast/i);
    expect(md).toContain("→");
  });
});

describe("packet · precise targeting context for weak models", () => {
  const located: ElementSnapshot = {
    selector: ".ghost",
    uniqueSelector: "main > section.hero > button.ghost:nth-of-type(2)",
    tag: "button",
    text: "Watch the tour",
    styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
    box: { x: 24, y: 512, width: 90, height: 32 },
  };

  it("carries the unique selector and viewport position", () => {
    const packet = buildPacket(located, analyzeElement(located));
    expect(packet.uniqueSelector).toBe("main > section.hero > button.ghost:nth-of-type(2)");
    expect(packet.box?.x).toBe(24);
    expect(packet.box?.y).toBe(512);
  });

  it("renders the exact selector to target and where it sits", () => {
    const md = packetToMarkdown(buildPacket(located, analyzeElement(located)));
    expect(md).toContain("main > section.hero > button.ghost:nth-of-type(2)");
    expect(md).toMatch(/24/);
    expect(md).toMatch(/512/);
  });
});

describe("packetToMarkdown · change-focused element context", () => {
  const rich: ElementSnapshot = {
    selector: "#cta",
    tag: "button",
    text: "Get started",
    uniqueSelector: "section.hero > button#cta",
    styles: {
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(37, 99, 235)",
      fontSize: "15px",
      fontWeight: "600",
      fontFamily: "Inter",
      padding: "8px 16px",
      margin: "0px",
      borderRadius: "8px",
      display: "inline-block",
    },
    box: { x: 40, y: 120, width: 140, height: 44 },
    a11y: { role: "button", name: "Get started" },
    outerHTML: '<button id="cta" class="hero-cta">Get started</button>',
  };

  it("leads with the element, its current styles, and its HTML", () => {
    const md = packetToMarkdown(buildPacket(rich, []));
    expect(md).toMatch(/#cta/);
    expect(md).toMatch(/Current styles/);
    expect(md).toMatch(/rgb\(37, 99, 235\)/); // the current background, so the agent sees the look
    expect(md).toMatch(/Inter/);
    expect(md).toMatch(/padding 8px 16px/);
    expect(md).toContain("```html");
    expect(md).toContain('<button id="cta"');
    expect(md).toMatch(/button#cta/); // the unique target
  });

  it("does not push a score or an empty findings section at the agent for a clean element", () => {
    const md = packetToMarkdown(buildPacket(rich, []));
    expect(md).not.toMatch(/Score: 100/);
    expect(md).not.toMatch(/0 finding/);
    expect(md.toLowerCase()).not.toContain("loupe findings");
  });
});
