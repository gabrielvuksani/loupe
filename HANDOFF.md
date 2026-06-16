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

## Next, in priority order
1. Polish the Lens UI to match the prototype one-gesture feel: an on-page inspector popover with the element verdict and dispatch in place, not only the side panel. Reference: prototypes/03-lens-extension.html.
2. Wire the closed loop. Connected mode sends the element packet today; the apply plus re-verify round trip to a live CLI agent (via a PostToolUse hook) is not wired yet.
3. More engine rules, each test-first, keeping the zero-false-positive guard green: spacing rhythm, accent-color count, semantic-tag vs visual-role, full axe-core in standalone.
4. Upgrade the contrast fix to culori/OKLCH and add APCA as a taste signal. Tests assert behavior, so they stay green through the swap.
5. Cross-browser standalone rule via @mdn/browser-compat-data + browserslist. Page rules via @projectwallace/css-analyzer. Re-verify diffs via pixelmatch.
6. The Conductor prototype: the user rejected its design. Rebuild it later as another face on the engine.

## Gotchas
- Extension service workers need headed Chromium in Playwright tests; headless does not load them.
- The MCP server uses the SDK low-level Server. The deprecation notice is cosmetic and stable across SDK versions.
- Lighthouse drives Playwright's bundled chromium via chrome-launcher, so no system Chrome is needed.
- BUILD_PLAN.md and prototypes/ are gitignored by intent.
- The engine package main is src/index.ts; consumers (Vite, tsx, vitest) compile the TS source directly.
