import { describe, it, expect } from "vitest";
import { analyzeElement, buildPacket } from "@loupe/engine";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeDispatch,
  composeBatchDispatch,
  composeTastePrompt,
  runCommand,
  gitDiffSummary,
  augmentedPath,
  agentNotFoundMessage,
} from "../src/agents";

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

describe("runCommand: live output streaming", () => {
  it("streams child output to onOutput as it runs and resolves ok on success", async () => {
    const chunks: string[] = [];
    const result = await runCommand(
      { cmd: process.execPath, args: ["-e", "process.stdout.write('hello loupe')"], cwd: process.cwd() },
      10000,
      (c) => chunks.push(c),
    );
    expect(result.ok).toBe(true);
    expect(chunks.join("")).toMatch(/hello loupe/);
    expect(result.stdout).toMatch(/hello loupe/);
  });

  it("resolves ok:false for a non-zero exit instead of throwing", async () => {
    const result = await runCommand(
      { cmd: process.execPath, args: ["-e", "process.exit(3)"], cwd: process.cwd() },
      10000,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
  });
});

describe("gitDiffSummary", () => {
  it("returns a string inside a git repo and null outside one", async () => {
    const inRepo = await gitDiffSummary(process.cwd());
    expect(typeof inRepo).toBe("string");
    const notRepo = mkdtempSync(join(tmpdir(), "loupe-nogit-"));
    expect(await gitDiffSummary(notRepo)).toBeNull();
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

describe("augmentedPath: resolve agent CLIs under a stripped daemon PATH", () => {
  it("appends common CLI bin dirs missing from PATH", () => {
    const p = augmentedPath({ PATH: "/usr/bin", HOME: "/Users/x" });
    expect(p).toMatch(/(^|:)\/opt\/homebrew\/bin(:|$)/);
    expect(p).toContain("/Users/x/.local/bin");
  });

  it("keeps the existing PATH entries first so the user's PATH wins resolution", () => {
    const p = augmentedPath({ PATH: "/usr/local/bin:/usr/bin", HOME: "/Users/x" });
    expect(p.split(":")[0]).toBe("/usr/local/bin");
  });

  it("does not duplicate a dir already on PATH", () => {
    const p = augmentedPath({ PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/x" });
    expect(p.split(":").filter((d) => d === "/opt/homebrew/bin").length).toBe(1);
  });

  it("still adds system dirs when HOME is unset", () => {
    const p = augmentedPath({ PATH: "/usr/bin" });
    expect(p).toContain("/opt/homebrew/bin");
  });
});

describe("agentNotFoundMessage", () => {
  it("names the missing command and includes the PATH the daemon saw", () => {
    const msg = agentNotFoundMessage("claude", "/usr/bin:/opt/homebrew/bin");
    expect(msg).toMatch(/claude/);
    expect(msg).toMatch(/PATH=\/usr\/bin:\/opt\/homebrew\/bin/);
    expect(msg).toMatch(/loupe serve/);
  });
});
