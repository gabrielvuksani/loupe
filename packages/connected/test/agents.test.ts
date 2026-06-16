import { describe, it, expect } from "vitest";
import { analyzeElement, buildPacket } from "@loupe/engine";
import { composeDispatch, composeBatchDispatch, composeTastePrompt } from "../src/agents";

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

describe("composeDispatch · user request", () => {
  it("carries the user's requested change into the prompt alongside the context", () => {
    const d = composeDispatch("Claude Code", packet, "/repo", "make it the primary blue and bigger");
    const prompt = d.args.join("\n");
    expect(prompt).toMatch(/make it the primary blue and bigger/);
    expect(prompt).toMatch(/contrast/i);
  });

  it("falls back to fixing the findings when no request is given", () => {
    const d = composeDispatch("Claude Code", packet, "/repo");
    expect(d.args.join("\n")).toMatch(/highest-severity fix/i);
  });
});

describe("composeBatchDispatch: fix everything from a page audit", () => {
  const findings = analyzeElement({
    selector: ".ghost",
    tag: "button",
    styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
  });

  it("composes a Claude Code apply carrying every finding and the page score", () => {
    const d = composeBatchDispatch("Claude Code", findings, "/repo", undefined, {
      url: "https://x.test",
      score: 60,
    });
    expect(d.cmd).toBe("claude");
    expect(d.cwd).toBe("/repo");
    const prompt = d.args.join("\n");
    expect(prompt).toMatch(/page audit/i);
    expect(prompt).toMatch(/contrast/i);
    expect(prompt).toMatch(/score 60\/100/);
  });

  it("carries the user's request across the whole page", () => {
    const d = composeBatchDispatch("Codex", findings, "/repo", "tighten the visual hierarchy");
    expect(d.cmd).toBe("codex");
    expect(d.args.join("\n")).toMatch(/tighten the visual hierarchy/);
  });
});

describe("composeTastePrompt", () => {
  it("asks for a 0 to 10 taste score and points back at the score tool", () => {
    const p = composeTastePrompt(packet);
    expect(p).toMatch(/0 to 10/);
    expect(p).toMatch(/loupe_score_taste/);
    expect(p).toMatch(/\.ghost/);
  });
});
