import { describe, it, expect } from "vitest";
import { analyzeElement, buildPacket } from "@goldeye/engine";
import { popoverHtml } from "../entrypoints/lib/view";

const snap = {
  selector: ".ghost",
  tag: "button",
  text: "Watch the tour",
  styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
};
const packet = buildPacket(snap, analyzeElement(snap));

describe("popoverHtml", () => {
  it("renders the verdict, findings, and actions for the selected element", () => {
    const html = popoverHtml(packet, { connected: true, agent: "Claude Code" });
    expect(html).toContain("/100");
    expect(html).toMatch(/contrast/);
    expect(html).toMatch(/Send to Claude Code/);
    expect(html).toMatch(/Copy/);
    expect(html).toMatch(/Preview/);
  });

  it("shows no Send action in standalone mode", () => {
    const html = popoverHtml(packet, { connected: false, agent: "Codex" });
    expect(html).not.toMatch(/Send to/);
    expect(html).toMatch(/Copy/);
  });

  it("escapes element text and selectors so a hostile page cannot inject markup", () => {
    const evil = buildPacket(
      { selector: '"><img src=x onerror=alert(1)>', tag: "div", text: "<script>bad</script>", styles: {} },
      [],
    );
    const html = popoverHtml(evil, { connected: false, agent: "Codex" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;");
  });

  it("renders the screenshot img when the packet has a data-image URL", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const shot = { ...packet, screenshot: dataUrl };
    const html = popoverHtml(shot, { connected: false, agent: "Codex" });
    expect(html).toContain("<img");
    expect(html).toContain(dataUrl);
  });

  it("renders no img when the packet has no screenshot", () => {
    const html = popoverHtml(packet, { connected: false, agent: "Codex" });
    expect(html).not.toContain("<img");
  });

  it("ignores a screenshot that is not a data-image URL", () => {
    const evil = { ...packet, screenshot: "javascript:alert(1)" };
    const html = popoverHtml(evil, { connected: false, agent: "Codex" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("shows the before-to-after score climb after a re-verify", () => {
    const html = popoverHtml(packet, { connected: false, agent: "Codex", climbFrom: 72 });
    expect(html).toMatch(/72\s*&rarr;/);
    expect(html).toContain(`${packet.score}/100`);
  });
});
