import { spawn } from "node:child_process";
import { packetToMarkdown, type ElementPacket } from "@goldeye/engine";

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

function buildPrompt(packet: ElementPacket): string {
  return [
    packetToMarkdown(packet),
    "",
    "Apply the highest-severity fix above to the source for this element. Make the smallest change that resolves the finding, then stop.",
  ].join("\n");
}

// Compose the exact CLI invocation to apply a packet's fix in the project root.
// The spawn fallback for the pull model: used when no agent session is live.
export function composeDispatch(
  agent: AgentName,
  packet: ElementPacket,
  cwd: string,
): DispatchCommand {
  const prompt = buildPrompt(packet);
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
): Promise<DispatchResult> {
  const { cmd, args } = composeDispatch(agent, packet, cwd);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) =>
      resolve({ ok: false, code: null, stdout, stderr: `${cmd} not available: ${e.message}` }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}
