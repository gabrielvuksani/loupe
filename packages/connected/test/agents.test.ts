import { describe, it, expect } from "vitest";
import { analyzeElement, buildPacket } from "@goldeye/engine";
import { composeDispatch, composeTastePrompt } from "../src/agents";

const packet = buildPacket(
  { selector: ".ghost", tag: "button", styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" } },
  analyzeElement({ selector: ".ghost", tag: "button", styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" } }),
);

describe("composeDispatch: existing-session spawn fallback per agent", () => {
  it("composes a headless Claude Code apply in the project root, carrying the packet", () => {
    const d = composeDispatch("Claude Code", packet, "/repo");
    expect(d.cmd).toBe("claude");
    expect(d.args).toContain("-p");
    expect(d.cwd).toBe("/repo");
    expect(d.args.join("\n")).toMatch(/contrast/i);
  });

  it("composes codex exec with a writable sandbox", () => {
    const d = composeDispatch("Codex", packet, "/repo");
    expect(d.cmd).toBe("codex");
    expect(d.args.slice(0, 3)).toEqual(["exec", "--sandbox", "workspace-write"]);
    expect(d.cwd).toBe("/repo");
  });

  it("composes an opencode run", () => {
    const d = composeDispatch("OpenCode", packet, "/repo");
    expect(d.cmd).toBe("opencode");
    expect(d.args[0]).toBe("run");
  });
});

describe("composeTastePrompt", () => {
  it("asks for a 0 to 10 taste score and points back at the score tool", () => {
    const p = composeTastePrompt(packet);
    expect(p).toMatch(/0 to 10/);
    expect(p).toMatch(/goldeye_score_taste/);
    expect(p).toMatch(/\.ghost/);
  });
});
