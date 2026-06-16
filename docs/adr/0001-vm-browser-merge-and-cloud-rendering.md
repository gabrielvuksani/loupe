# ADR 0001: vm-browser merge and cloud rendering

Status: Accepted
Date: 2026-06-16

## Context

goldeye was framed as a merge of a design-verification tool with a prior project,
vm-browser (Candidis), which lives at `~/Projects/vm-browser`. Two constraints were
set: do not merge for the sake of merging, and do not take on a Cloudflare dependency
if a better free option exists.

What vm-browser is today: an MIT-licensed AI agent runtime that hosts on Cloudflare's
free tier (Workers plus Browser Rendering). Its core thesis is "MCP-server-not-harness":
it exposes itself as an MCP server so the user's existing Claude Code / Codex / Copilot
session drives it with their own subscription, and it never sees the LLM credentials.
The repo is mid-pivot (emulator platform to agent runtime); its current HEAD is a
pre-pivot artifact, so its code is a moving target.

## Decision

1. No code merge now. goldeye already embodies vm-browser's central idea: the pull
   model added this session (goldeye_get_selection over MCP, the agent edits its own
   cwd, goldeye never holds credentials) is the same MCP-server-not-harness pattern,
   applied to design and accessibility verification instead of general browsing. There
   is no second copy of that idea worth importing, and vm-browser is mid-pivot and
   unstable. Merging code would add risk for no gain.

2. Cloud rendering is deferred, local-first. Local Playwright already is the connected
   engine: it renders any URL, runs axe-core and Lighthouse, and costs nothing. A cloud
   renderer only helps one case, analyzing a URL on a machine with no local browser. If
   that case ever matters, evaluate a self-hostable option first (Browserless, or a
   remote Playwright server) so there is no vendor lock-in. Cloudflare Browser Rendering
   is a last resort, chosen only if a free, self-hostable path proves unworkable.

3. Revisit later, not now: vm-browser's `packages/agent-protocols` hybrid router
   (WebMCP, then MCP, then DOM, then vision) is the one piece worth watching. If goldeye
   ever needs to act on a page rather than only judge it, that router is the reference.
   Wait until vm-browser stabilizes post-pivot before depending on it.

## Consequences

- goldeye stays local-first and dependency-light. No premature cloud or vendor coupling.
- The conceptual lineage is recorded: the pull-MCP loop is the design-verification
  expression of vm-browser's agent-runtime thesis.
- If a hosted "analyze any URL" product is wanted later, this ADR is the starting point,
  and the first move is a self-hostable renderer, not Cloudflare.
