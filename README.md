# goldeye

A self-verifying browser. Point it at any page and it reports, deterministically and with no AI, what is wrong with the design and accessibility, and the exact fix. AI is used only to apply fixes to your code and for the subjective part of taste.

The loop is render, judge, fix, re-judge. Detection and fix computation are deterministic (WCAG contrast, target size, type scale, palette and typography variety). Your own CLI agent (Claude Code, Codex, OpenCode) applies the fix, so the moat sits with detection and the loop rather than with code generation.

## Packages

| Package | What it is | Status |
|---|---|---|
| `packages/engine` | Pure deterministic detection and fix computation. No DOM, no AI. | 14 unit tests |
| `packages/extension` | The Lens. WXT MV3 extension. Runs the engine in-page (Standalone). | builds + loaded-extension e2e |
| `packages/connected` | Node engine: Playwright, axe-core, Lighthouse, exposed as an MCP server and a WebSocket bridge. | unit + real-browser integration |

## Run

```
pnpm install              # installs everything, including Playwright Chromium
pnpm test                 # 16 unit tests (fast)
pnpm test:integration     # real browser: render, axe, Lighthouse, loaded extension
```

## packages/engine

Pure functions over an `ElementSnapshot` or `PageSnapshot`. The content script captures, the engine analyzes. Every rule is a small unit, and a zero-false-positive guard test stays green for every new rule.

- `analyzeElement(snapshot)`: contrast (with minimal-color fix), target size (with size fix), large-text threshold.
- `analyzePage(snapshot)`: font variety (max 2), font weights (max 3), type scale (no two steps closer than 25%).
- `scoreFindings(findings)`: deterministic weighted deduction to a 0 to 100 score, overall and per category.
- `buildPacket`, `packetToMarkdown`: the agent-pasteable context packet.
- `captureElement`, `capturePage`: DOM to snapshot, shared by the extension and Playwright.

Scale strategy: infer the page's own system from used values, grade it against universal invariants (Refactoring UI), optionally check against an authored canonical system. Works on pages you do not own.

## packages/extension (the Lens)

```
pnpm --filter @goldeye/extension build    # output: packages/extension/.output/chrome-mv3
```

Load it: open `chrome://extensions`, enable Developer mode, Load unpacked, select `.output/chrome-mv3`. Click the toolbar icon to open the side panel.

- Standalone (default): the engine runs entirely in-page. Free, offline, nothing leaves the tab. Inspect element clicks any element for a verdict and fix; Scan page runs a page-health audit.
- Connected: streams element packets over a localhost WebSocket to the connected engine and your CLI agent to apply, then re-verify.
- Dispatch to Claude Code, Codex, or OpenCode. Standalone copies the packet markdown; Connected sends it.

## packages/connected (MCP server + real browser)

```
pnpm --filter @goldeye/connected mcp       # MCP server on stdio
pnpm --filter @goldeye/connected bridge    # WebSocket bridge on :8791 (for the extension)
```

Tools: `goldeye_analyze_url` (real Chromium render, engine findings, axe-core, Lighthouse scores) and `goldeye_analyze_element` (engine packet). Wire it to a CLI agent:

```
claude mcp add goldeye -- pnpm --dir <abs-path>/packages/connected mcp
```

The loop is closed by an agent PostToolUse hook that re-runs goldeye after the agent edits.

## Verification

| Layer | How it is verified |
|---|---|
| Engine rules and fixes | 14 unit tests including the zero-false-positive guard; strict typecheck |
| MCP protocol and WS bridge | in-memory MCP client round-trip and live WebSocket round-trip |
| Real render, axe, Lighthouse | integration test renders a fixture in real Chromium and returns findings plus a numeric Lighthouse score |
| Extension end to end | built MV3 loaded into headed Chromium runs the engine in-page and returns findings |

Not yet automated (manual): clicking through the Lens UI interactively, and a live agent applying then re-verifying a fix.

Cross-platform: Node, Playwright, and WebSocket only, with no OS-specific paths. Tested on macOS, portable to Windows.
