import { spawn } from "node:child_process";
import { packetToMarkdown, findingsToMarkdown, type ElementPacket, type Finding } from "@loupe/engine";

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

export interface PageContext {
  url?: string;
  score?: number;
}

function buildPrompt(packet: ElementPacket, request?: string): string {
  const want = (request ?? "").trim();
  const instruction = want
    ? `The user wants this change applied to the element above:\n"${want}"\n\nMake that change in the source for this element, keep the surrounding design consistent, then re-verify with loupe_reverify.`
    : "Apply the highest-severity fix above to the source for this element. Make the smallest change that resolves the finding, then stop.";
  return [packetToMarkdown(packet), "", instruction].join("\n");
}

// The batch prompt: every finding on the page, grouped by element, each with its
// computed fix. This is "fix everything" in one dispatch.
function buildBatchPrompt(findings: readonly Finding[], request?: string, context?: PageContext): string {
  const want = (request ?? "").trim();
  const instruction = want
    ? `Across this page, the user wants:\n"${want}"\n\nApply the fixes above in the source with that goal in mind, keep the design consistent, then re-verify with loupe_reverify.`
    : "Apply the fixes above in the source, highest severity first. Make the smallest change that resolves each finding, keep the design consistent, then re-verify with loupe_reverify.";
  return [findingsToMarkdown(findings, context), "", instruction].join("\n");
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

// The CLI invocation that runs a prompt headlessly in the project root, per agent.
function composePromptCommand(agent: AgentName, prompt: string, cwd: string): DispatchCommand {
  switch (agent) {
    case "Claude Code":
      return { cmd: "claude", args: ["-p", prompt, "--permission-mode", "acceptEdits"], cwd };
    case "Codex":
      return { cmd: "codex", args: ["exec", "--sandbox", "workspace-write", prompt], cwd };
    case "OpenCode":
      return { cmd: "opencode", args: ["run", prompt], cwd };
  }
}

// Compose the exact CLI invocation to apply a packet's fix in the project root.
// The spawn fallback for the pull model: used when no agent session is live.
export function composeDispatch(
  agent: AgentName,
  packet: ElementPacket,
  cwd: string,
  request?: string,
): DispatchCommand {
  return composePromptCommand(agent, buildPrompt(packet, request), cwd);
}

// Compose a "fix everything" dispatch from a whole page audit.
export function composeBatchDispatch(
  agent: AgentName,
  findings: readonly Finding[],
  cwd: string,
  request?: string,
  context?: PageContext,
): DispatchCommand {
  return composePromptCommand(agent, buildBatchPrompt(findings, request, context), cwd);
}

// Spawn a composed command, returning its output. Resolves with ok:false rather
// than throwing when the agent binary is not installed. onOutput, when given,
// receives each stdout/stderr chunk as it arrives, so the caller can stream the
// agent's progress live instead of waiting for the final result.
export function runCommand(
  { cmd, args, cwd }: DispatchCommand,
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<DispatchResult> {
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
    child.stdout?.on("data", (d) => {
      stdout = cap(stdout, d);
      onOutput?.(String(d));
    });
    child.stderr?.on("data", (d) => {
      stderr = cap(stderr, d);
      onOutput?.(String(d));
    });
    child.on("error", (e) =>
      finish({ ok: false, code: null, stdout, stderr: `${cmd} not available: ${e.message}` }),
    );
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

// Run a composed single-element dispatch, returning its output.
export function runDispatch(
  agent: AgentName,
  packet: ElementPacket,
  cwd: string,
  request?: string,
  timeoutMs = 600000,
  onOutput?: (chunk: string) => void,
): Promise<DispatchResult> {
  return runCommand(composeDispatch(agent, packet, cwd, request), timeoutMs, onOutput);
}

// Run a "fix everything" batch dispatch over a whole page audit.
export function runBatchDispatch(
  agent: AgentName,
  findings: readonly Finding[],
  cwd: string,
  request?: string,
  context?: PageContext,
  timeoutMs = 600000,
  onOutput?: (chunk: string) => void,
): Promise<DispatchResult> {
  return runCommand(composeBatchDispatch(agent, findings, cwd, request, context), timeoutMs, onOutput);
}
