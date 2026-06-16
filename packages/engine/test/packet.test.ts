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
