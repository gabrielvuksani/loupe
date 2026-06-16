# goldeye handoff

v0 is built and green. A 3-package pnpm monorepo on branch feat/goldeye. Read README.md first for the what and the run commands.

## State
- packages/engine: deterministic detection and fix computation. 14 unit tests, typecheck clean.
- packages/connected: MCP server, WebSocket bridge, real Playwright + axe-core + Lighthouse. unit + integration green.
- packages/extension: WXT MV3 Lens. builds, typechecks, loaded-extension e2e green.
- 16 unit tests + 2 real-browser integration tests, all passing.

## Run
- pnpm install
- pnpm test (16 unit, fast)
- pnpm test:integration (real browser; the extension e2e needs headed Chromium, works on macOS)
- pnpm --filter @goldeye/extension build, then load .output/chrome-mv3 unpacked at chrome://extensions
- pnpm --filter @goldeye/connected mcp (or bridge)

## Key files
- engine: src/{analyze,page,contrast,score,packet,capture,types,index}.ts
- connected: src/{playwright-adapter,lighthouse-adapter,mcp-server,ws-bridge,bin}.ts
- extension: entrypoints/{content,background}.ts, entrypoints/sidepanel/{index.html,main.ts}
- Lens design reference (gitignored): prototypes/03-lens-extension.html

## Next
The full autonomous plan with acceptance criteria is in NEXT_SESSION.md. It closes
every gap from the last session in priority order: the closed loop, live agent
dispatch, the on-page popover, the expanded packet with a screenshot, axe in
standalone, the adopted libraries, the full taste rule set, and the Candidis merge.

## Known gaps in this build (be honest, do not reclaim these as done)
- The closed loop is not wired. The engine detects and computes fixes; nothing applies or re-verifies.
- Connected "Send to agent" is a no-op. The WS bridge ignores the dispatch message.
- There is no on-page popover. Results go to the side panel only, so the chosen one-gesture flow is unmet.
- The packet has no screenshot, outerHTML, a11y node, or source location.
- Standalone does not run axe-core. axe runs only in the connected Playwright path.
- culori, browser-compat-data, projectwallace, pixelmatch, APCA, element-source are not installed or used.
- Two taste rules exist (font count, type scale). The full Refactoring-UI set and the AI taste score are not built.

## Gotchas
- Extension service workers need headed Chromium in Playwright tests; headless does not load them.
- The MCP server uses the SDK low-level Server. The deprecation notice is cosmetic and stable across SDK versions.
- Lighthouse drives Playwright's bundled chromium via chrome-launcher, so no system Chrome is needed.
- BUILD_PLAN.md and prototypes/ are gitignored by intent.
- The engine package main is src/index.ts; consumers (Vite, tsx, vitest) compile the TS source directly.
