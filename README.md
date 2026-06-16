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
pnpm --filter @goldeye/connected serve     # one process: WS bridge (:8791) + MCP server, shared selection
pnpm --filter @goldeye/connected mcp       # MCP server only (stdio)
pnpm --filter @goldeye/connected bridge    # WebSocket bridge only (:8791)
```

Tools the agent calls from its own session:

- `goldeye_get_selection`: pull the element the Lens has selected (findings, computed fixes, a11y node, source hint, and a cropped screenshot for vision).
- `goldeye_reverify`: re-render a URL and report the before and after score. This is the loop.
- `goldeye_score_taste`: record a subjective 0 to 10 taste read. The engine stays deterministic; this is the agent's judgment, surfaced as advisory.
- `goldeye_analyze_url`, `goldeye_analyze_element`: real render and engine packet.

Register goldeye in your agent (works with Claude Code, Codex, OpenCode):

```
claude mcp add --transport stdio goldeye -- pnpm --dir <abs-path>/packages/connected serve
```

The loop is pull-primary: select an element in the Lens, your running agent pulls it, edits its own repo, and calls `goldeye_reverify` to show the score climb. No LLM credentials leave your machine. A spawn fallback (`claude -p`, `codex exec`) covers the case where no session is live.

## Verification

| Layer | How it is verified |
|---|---|
| Engine rules and fixes | 14 unit tests including the zero-false-positive guard; strict typecheck |
| MCP protocol and WS bridge | in-memory MCP client round-trip and live WebSocket round-trip |
| Real render, axe, Lighthouse | integration test renders a fixture in real Chromium and returns findings plus a numeric Lighthouse score |
| Closed loop | integration test applies a computed contrast fix to a real render, re-judges, and the contrast finding is gone while the score rose |
| Extension end to end | built MV3 in headed Chromium: scans a page, renders the on-page popover on click, and merges axe-core findings in Standalone |

Automated now: the deterministic loop, the on-page popover, and axe in Standalone all have passing tests. Still manual: a live CLI agent editing source then re-verifying end to end. The dispatch command composition per agent is unit-tested; the real spawn is opt-in because it edits files and spends tokens.

Cross-platform: Node, Playwright, and WebSocket only, with no OS-specific paths. Tested on macOS, portable to Windows.
