# goldeye handoff

A 3-package pnpm monorepo on branch feat/design-mode-feature. Read README.md first
for the what and the run commands. The architecture decisions are in
docs/adr/0001 and in Engram (topic_key architecture/goldeye-loop).

## State (2026-06-16)
- packages/engine: deterministic detection plus fix computation. OKLCH hue-preserving
  contrast fix (culori) with a blend alternative, APCA advisory signal (apca-w3),
  contrast / target-size / large-text, and taste rules (font count, weights, type
  scale, spacing-scale, line-length, semantic-tag, color-count, accent-spread,
  shades-per-color). The page snapshot captures per-color frequency (colorUsage).
  reverifyElement is the pure loop primitive.
- packages/connected: ONE serve process = WS bridge (:8791) + MCP server sharing a
  selection store. Tools: get_selection, reverify, score_taste, analyze_url,
  analyze_element. reverifyAfterFix applies fixes to a real render and re-judges,
  returning a pixelmatch visual delta. renderAndAnalyze also runs a cross-browser
  rule (browser-compat-data + browserslist + projectwallace css-analyzer). Agent
  dispatch (composeDispatch / runDispatch) for Claude Code, Codex, OpenCode.
- packages/extension: WXT MV3 Lens. On-page shadow-DOM popover with full actions,
  axe-core in Standalone, a11y node + source + screenshot capture, publishes the
  selection and dispatches over the bridge. Side panel mirrors the selection.
- 73 unit tests and 4 real-browser integration tests are green; a 5th gated
  live-dispatch e2e was run live with Claude Code and passed. Typecheck clean across
  all 3 packages.

## Run
- pnpm install
- pnpm test (39 unit, fast)
- pnpm test:integration (real browser; the extension e2e needs headed Chromium, macOS ok)
- pnpm --filter @goldeye/extension build, then load .output/chrome-mv3 unpacked
- pnpm --filter @goldeye/connected serve  (the WS bridge + MCP server together)

## Pull loop, in one line
Register goldeye as an MCP server in your agent, select an element in the Lens, the
agent calls goldeye_get_selection, edits its own repo, then calls goldeye_reverify.

Verification status (be precise): the in-process seam (WS publish -> shared store ->
MCP get_selection) is unit-tested, and the SPAWN fallback (runDispatch -> claude/codex
edits source -> re-judge) ran live with Claude Code and passed. The full PULL path with
a real browser plus a real agent session has NOT been run end to end yet. Caveat: the
documented `claude mcp add --transport stdio ... serve` spawns serve PER agent, and that
subprocess binds :8791 for the browser. So Connected mode only works while an agent
session is up, and you must NOT also run a separate `pnpm serve` (it would fail to bind
:8791 and the agent would read an empty store). A long-running serve daemon with an
HTTP/SSE MCP transport is the recommended follow-up to make pull robust.

## Remaining (honest)
- The page snapshot now captures per-color frequency (colorUsage), so accent-spread
  (the deterministic core of 60-30-10: limit competing saturated accents) and
  shades-per-color (a heavily reused accent stuck at one flat shade) are built and
  zero-FP-tested. Of the original fuzzy set, only hierarchy levers is not a standalone
  rule: its intent (do not over-use every distinction lever at once) is already bounded
  by type-scale, font-weights, and color-count, with the subjective call left to the
  agent taste score.
- element-source: the npm package (0.0.5, no repository or docs) was deliberately NOT
  adopted. The inline React-fiber _debugSource and data-source detection is used instead.
- The live agent-applies-then-reverify e2e is GATED behind GOLDEYE_LIVE_DISPATCH=1 so it
  does not run in normal CI (it spawns an agent that edits files and spends tokens). It
  was run live with Claude Code on 2026-06-16 and passed end to end: the agent edited the
  fixture CSS, goldeye re-rendered, the contrast finding cleared and the score rose. Codex
  was blocked by an account usage limit that day, not a goldeye defect.

## Gotchas
- The WS bridge binds 127.0.0.1 and rejects non-extension origins (verifyClient), so a
  visited web page cannot drive the dispatch handler. Connected render paths reject
  non-http(s) URLs, and runDispatch has a kill-on-timeout and an output cap.
- Extension service workers need headed Chromium in Playwright tests; headless does not load them.
- The content script bundles axe-core, so it is ~650KB. A future win is lazy-loading axe.
- The MCP server uses the SDK low-level Server; the deprecation notice is cosmetic.
- Lighthouse drives Playwright's bundled chromium via chrome-launcher; no system Chrome needed.
- The engine package main is src/index.ts; consumers compile the TS source directly.
- The selection store only works when the WS bridge and MCP server share one process (serve).
