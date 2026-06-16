import { describe, it, expect } from "vitest";
import { buildPacket, packetToMarkdown, analyzeElement } from "../src/index";

describe("packet: expanded element context", () => {
  const snap = {
    selector: "button.ghost",
    tag: "button",
    text: "Watch the tour",
    styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
    a11y: { role: "button", name: "Watch the tour" },
    source: { file: "src/Hero.tsx", line: 42 },
    outerHTML: '<button class="ghost">Watch the tour</button>',
  };

  it("carries the a11y node and source location into the packet", () => {
    const packet = buildPacket(snap, analyzeElement(snap));
    expect(packet.a11y?.role).toBe("button");
    expect(packet.a11y?.name).toBe("Watch the tour");
    expect(packet.source?.file).toBe("src/Hero.tsx");
    expect(packet.source?.line).toBe(42);
  });

  it("renders the a11y node and source location in the markdown", () => {
    const md = packetToMarkdown(buildPacket(snap, analyzeElement(snap)));
    expect(md).toMatch(/role.*button/i);
    expect(md).toMatch(/src\/Hero\.tsx:42/);
  });
});
