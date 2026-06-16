# goldeye handoff

A 3-package pnpm monorepo on branch feat/design-mode-feature. Read README.md first
for the what and the run commands. The architecture decisions are in
docs/adr/0001 and in Engram (topic_key architecture/goldeye-loop).

## State (2026-06-16)
- packages/engine: deterministic detection plus fix computation. OKLCH hue-preserving
  contrast fix (culori) with a blend alternative, APCA advisory signal (apca-w3),
  contrast / target-size / large-text, and taste rules (font count, weights, type
  scale, spacing-scale). reverifyElement is the pure loop primitive.
- packages/connected: ONE serve process = WS bridge (:8791) + MCP server sharing a
  selection store. Tools: get_selection, reverify, score_taste, analyze_url,
  analyze_element. reverifyAfterFix applies fixes to a real render and re-judges.
  Agent dispatch (composeDispatch / runDispatch) for Claude Code, Codex, OpenCode.
- packages/extension: WXT MV3 Lens. On-page shadow-DOM popover with full actions,
  axe-core in Standalone, a11y node + source + screenshot capture, publishes the
  selection and dispatches over the bridge. Side panel mirrors the selection.
- 39 unit tests, 4 real-browser integration tests, all green. Typecheck clean.

## Run
- pnpm install
- pnpm test (39 unit, fast)
- pnpm test:integration (real browser; the extension e2e needs headed Chromium, macOS ok)
- pnpm --filter @goldeye/extension build, then load .output/chrome-mv3 unpacked
- pnpm --filter @goldeye/connected serve  (the WS bridge + MCP server together)

## Pull loop, in one line
Register goldeye as an MCP server in your agent, select an element in the Lens, the
agent calls goldeye_get_selection, edits its own repo, then calls goldeye_reverify.

## Remaining (honest, not done)
- Cross-browser rule (@mdn/browser-compat-data + browserslist + @projectwallace/css-analyzer)
  is NOT built. It is a connected-only feature (BCD is large; the engine must stay light
  for the content-script bundle). The "cross-browser" Finding category exists but has no rule yet.
- pixelmatch visual diff in the re-verify step is NOT built.
- element-source is implemented INLINE (React fiber _debugSource and data-source attrs),
  not via the npm package. Same behavior, one fewer dep. Documented choice, not the lib.
- The full Refactoring-UI taste set is PARTIAL. spacing-scale was added; line-length,
  accent-count, hierarchy levers, semantic-tag-vs-role, and shades-per-color were
  deferred on purpose: they are fuzzy and would risk the zero-false-positive guard, so
  the subjective half is handled by the agent taste score instead (the thesis).
- The live end-to-end agent-applies-then-reverify is MANUAL. composeDispatch is
  unit-tested per agent; the real spawn is opt-in (it edits files and spends tokens).

## Gotchas
- Extension service workers need headed Chromium in Playwright tests; headless does not load them.
- The content script bundles axe-core, so it is ~650KB. A future win is lazy-loading axe.
- The MCP server uses the SDK low-level Server; the deprecation notice is cosmetic.
- Lighthouse drives Playwright's bundled chromium via chrome-launcher; no system Chrome needed.
- The engine package main is src/index.ts; consumers compile the TS source directly.
- The selection store only works when the WS bridge and MCP server share one process (serve).
