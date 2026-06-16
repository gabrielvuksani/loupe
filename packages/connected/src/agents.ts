import { spawn } from "node:child_process";
import { packetToMarkdown, type ElementPacket } from "@loupe/engine";

export type AgentName = "Claude Code" | "Codex" | "OpenCode";

export interface DispatchCommand {
  cmd: string;
  args: string[];
  cwd: string;
}

export interface DispatchResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function buildPrompt(packet: ElementPacket, request?: string): string {
  const want = (request ?? "").trim();
  const instruction = want
    ? `The user wants this change applied to the element above:\n"${want}"\n\nMake that change in the source for this element, keep the surrounding design consistent, then re-verify with loupe_reverify.`
    : "Apply the highest-severity fix above to the source for this element. Make the smallest change that resolves the finding, then stop.";
  return [packetToMarkdown(packet), "", instruction].join("\n");
}

// The prompt an agent uses to score taste. The engine never judges taste; this
// subjective read comes from the agent already in the loop.
export function composeTastePrompt(packet: ElementPacket): string {
  return [
    packetToMarkdown(packet),
    "",
    "Rate the visual taste of this element from 0 to 10 (typography, spacing, hierarchy, restraint), independent of the deterministic findings above. Then call loupe_score_taste with your integer score and one sentence of reasoning.",
  ].join("\n");
}

// Compose the exact CLI invocation to apply a packet's fix in the project root.
// The spawn fallback for the pull model: used when no agent session is live.
export function composeDispatch(
  agent: AgentName,
  packet: ElementPacket,
  cwd: string,
  request?: string,
): DispatchCommand {
  const prompt = buildPrompt(packet, request);
  switch (agent) {
    case "Claude Code":
      return { cmd: "claude", args: ["-p", prompt, "--permission-mode", "acceptEdits"], cwd };
    case "Codex":
      return { cmd: "codex", args: ["exec", "--sandbox", "workspace-write", prompt], cwd };
    case "OpenCode":
      return { cmd: "opencode", args: ["run", prompt], cwd };
  }
}

// Run a composed dispatch, returning its output. Resolves with ok:false rather
// than throwing when the agent binary is not installed.
export function runDispatch(
  agent: AgentName,
  packet: ElementPacket,
  cwd: string,
  request?: string,
  timeoutMs = 600000,
): Promise<DispatchResult> {
  const { cmd, args } = composeDispatch(agent, packet, cwd, request);
  return new Promise((resolve) => {
    const MAX_OUTPUT = 1_000_000;
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cap = (s: string, d: unknown): string =>
      s.length >= MAX_OUTPUT ? s : (s + String(d)).slice(0, MAX_OUTPUT);
    const finish = (r: DispatchResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: null, stdout, stderr: `${cmd} timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout = cap(stdout, d)));
    child.stderr?.on("data", (d) => (stderr = cap(stderr, d)));
    child.on("error", (e) =>
      finish({ ok: false, code: null, stdout, stderr: `${cmd} not available: ${e.message}` }),
    );
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}
