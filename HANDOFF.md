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
- 97 unit tests and 4 real-browser integration tests green. Gated e2e (opt-in): the
  full PULL flow ran live (a real MV3 extension in headed Chromium publishes a
  Connected-mode selection over the WS bridge, a real MCP-over-HTTP client pulls it),
  and the live-dispatch e2e ran with Claude Code. Typecheck clean across all 3 packages.
- packages/connected also serves a long-running MCP-over-HTTP daemon (`goldeye serve` =
  WS bridge :8791 + MCP on http://127.0.0.1:8792/mcp), ships as a self-contained esbuild
  bundle (`node dist/bin.js serve`), and has an optional one-time WS token (`serve --token`).

## Run
- pnpm install
- pnpm test (97 unit, fast)
- pnpm test:integration (real browser; 4 pass, gated pull/realworld/dispatch need flags)
- pnpm --filter @goldeye/extension build, then load .output/chrome-mv3 unpacked
- pnpm --filter @goldeye/connected serve  (the daemon: WS bridge :8791 + MCP over HTTP :8792)
- add `--token` for the optional one-time WS token

## Pull loop, in one line
Register goldeye as an MCP server in your agent, select an element in the Lens, the
agent calls goldeye_get_selection, edits its own repo, then calls goldeye_reverify.

Verification status (be precise): the full PULL path is now proven with real components.
A gated integration test (GOLDEYE_LIVE_PULL) runs the built MV3 extension in headed
Chromium, publishes a Connected-mode selection over the WS bridge from a chrome-extension
origin, and a real MCP-over-HTTP client (StreamableHTTPClientTransport, the exact transport
an agent uses) pulls it via goldeye_get_selection. Only the LLM deciding to call the tool is
absent, which is not a transport concern. The SPAWN fallback (runDispatch -> claude/codex
edits source -> re-judge) ran live with Claude Code. The old stdio port-collision footgun is
RESOLVED: `goldeye serve` is ONE long-running daemon (WS bridge :8791 + MCP over HTTP :8792)
and every agent attaches over http://127.0.0.1:8792/mcp, so there is no per-agent process and
no :8791 contention.

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

## Remaining for a real ship (status after the 2026-06-16 daemon session)
1. Productize: DONE. `goldeye serve` is a self-contained esbuild bundle
   (packages/connected/build.mjs inlines @goldeye/engine); `node dist/bin.js serve` boots
   the daemon with no monorepo. MCP registration docs for Claude Code (http), Codex, and
   OpenCode are in README. CI is at .github/workflows/ci.yml. STILL MANUAL: the actual
   `npm publish` (creds needed; bin/files/prepublishOnly are ready) to get the literal
   `npx goldeye serve`, and a real Windows run (only macOS verified).
2. Prove the pull flow end to end: DONE (see Verification status above).
3. Security depth: DONE. SSRF link-local/metadata blocking in assertRenderableUrl (allows
   loopback + RFC1918 dev servers). Optional one-time WS token via `goldeye serve --token`
   plus a Lens panel field.
4. Validation: DONE. The gated realworld.integration.test renders real production sites; it
   surfaced and drove a fix (target-size now exempts inline <a> per WCAG 2.5.5, which
   dropped the dominant false positive: HN target-size 59 -> 0, example.com a11y 88 -> 100).
   Visual QA: the built side panel matches prototype 03's palette and fonts.
5. Deferred future (unchanged): the app-maker, Conductor redesign, cloud mode, vm-browser
   merge. hierarchy-levers is intentionally not a standalone rule.
The branch is ready for the PR to main (superpowers:finishing-a-development-branch).

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
