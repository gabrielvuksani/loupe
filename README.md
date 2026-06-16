# loupe

A self-verifying browser. Point it at any page and it reports, deterministically and with no AI, what is wrong with the design and accessibility, and the exact fix. AI is used only to apply fixes to your code and for the subjective part of taste.

The loop is render, judge, fix, re-judge. Detection and fix computation are deterministic (WCAG contrast, target size, type scale, palette and typography variety). Your own CLI agent (Claude Code, Codex, OpenCode) applies the fix, so the moat sits with detection and the loop rather than with code generation.

## Packages

| Package | What it is | Status |
|---|---|---|
| `packages/engine` | Pure deterministic detection and fix computation. No DOM, no AI. | 40 unit tests |
| `packages/extension` | The Lens. WXT MV3 extension. Runs the engine in-page (Standalone). | builds + loaded-extension e2e |
| `packages/connected` | Node engine: Playwright, axe-core, Lighthouse, exposed as an MCP-over-HTTP daemon and a WebSocket bridge. | 40 unit + real-browser integration |

## Run

```
pnpm install              # installs everything, including Playwright Chromium
pnpm test                 # 93 unit tests (fast)
pnpm test:integration     # real browser: render, axe, Lighthouse, loaded extension
```

## packages/engine

Pure functions over an `ElementSnapshot` or `PageSnapshot`. The content script captures, the engine analyzes. Every rule is a small unit, and a zero-false-positive guard test stays green for every new rule.

- `analyzeElement(snapshot)`: contrast (OKLCH minimal-color fix plus an APCA signal), target size, large-text threshold, line length, and semantic tag vs role.
- `analyzePage(snapshot)`: font variety, font weights, type scale, spacing scale, text-color count, accent spread, and shades per color.
- Connected adds a cross-browser rule (browser-compat-data + browserslist + projectwallace) and a pixelmatch before/after visual delta on re-verify.
- `scoreFindings(findings)`: deterministic weighted deduction to a 0 to 100 score, overall and per category.
- `buildPacket`, `packetToMarkdown`: the agent-pasteable context packet.
- `captureElement`, `capturePage`: DOM to snapshot, shared by the extension and Playwright.

Scale strategy: infer the page's own system from used values, grade it against universal invariants (Refactoring UI), optionally check against an authored canonical system. Works on pages you do not own.

## packages/extension (the Lens)

```
pnpm --filter @loupe/extension build    # output: packages/extension/.output/chrome-mv3
```

Load it: open `chrome://extensions`, enable Developer mode, Load unpacked, select `.output/chrome-mv3`. Click the toolbar icon to open the side panel.

- Standalone (default): the engine runs entirely in-page. Free, offline, nothing leaves the tab. Inspect element clicks any element for a verdict and fix; Scan page runs a page-health audit.
- Connected: streams element packets over a localhost WebSocket to the connected engine and your CLI agent to apply, then re-verify.
- Dispatch to Claude Code, Codex, or OpenCode. Standalone copies the packet markdown; Connected sends it.

## packages/connected (the engine daemon: MCP over HTTP + real browser)

Run one long-lived daemon. The browser connects to the WebSocket bridge; every agent
attaches to the MCP endpoint over HTTP. They share one selection store, so an agent pulls
exactly what the Lens selected. One daemon serves every agent, so there is no per-agent
process and no port contention.

```
loupe serve     # WS bridge (ws://127.0.0.1:8791) + MCP over HTTP (http://127.0.0.1:8792/mcp)
```

From the repo: `pnpm --filter @loupe/connected serve`. As a standalone CLI:
`pnpm --filter @loupe/connected build`, then `node packages/connected/dist/bin.js serve`
(the bundle is self-contained; publish the package to get `npx loupe serve`).

Tools the agent calls from its own session:

- `loupe_get_selection`: pull the element the Lens has selected (findings, computed fixes, a11y node, source hint, and a cropped screenshot for vision).
- `loupe_reverify`: re-render a URL and report the before and after score. This is the loop.
- `loupe_score_taste`: record a subjective 0 to 10 taste read. The engine stays deterministic; this is the agent's judgment, surfaced as advisory.
- `loupe_analyze_url`, `loupe_analyze_element`: real render and engine packet.

Register the running daemon once in your agent:

```
# Claude Code
claude mcp add --transport http loupe http://127.0.0.1:8792/mcp

# Codex (streamable HTTP; SSE is not supported)
codex mcp add loupe --url http://127.0.0.1:8792/mcp
```

```jsonc
// OpenCode (opencode.json, project root or ~/.config/opencode/)
{
  "mcp": {
    "loupe": { "type": "remote", "url": "http://127.0.0.1:8792/mcp", "enabled": true }
  }
}
```

The loop is pull-primary: select an element in the Lens, your running agent pulls it, edits
its own repo, and calls `loupe_reverify` to show the score climb. No LLM credentials leave
your machine. For sessions where no agent is attached, a bare stdio server
(`pnpm --filter @loupe/connected mcp`) and a spawn fallback (`claude -p`, `codex exec`)
remain. The WS bridge binds loopback and accepts only `chrome-extension://` origins; the HTTP
endpoint rejects any request that carries a browser `Origin` header. For extra hardening,
`loupe serve --token` prints a one-time token the bridge then requires; paste it into the
Lens panel's token field.

## Verification

| Layer | How it is verified |
|---|---|
| Engine rules and fixes | 40 unit tests including the zero-false-positive guard; strict typecheck |
| MCP protocol and WS bridge | in-memory and over-HTTP MCP client round-trips, plus a live WebSocket round-trip |
| Real render, axe, Lighthouse | integration test renders a fixture in real Chromium and returns findings plus a numeric Lighthouse score |
| Closed loop | integration test applies a computed contrast fix to a real render, re-judges, and the contrast finding is gone while the score rose |
| Extension end to end | built MV3 in headed Chromium: scans a page, renders the on-page popover on click, and merges axe-core findings in Standalone |
| Pull flow end to end | gated integration (`LOUPE_LIVE_PULL`): the built extension in headed Chromium publishes a Connected-mode selection over the WS bridge, and a real MCP-over-HTTP client pulls it via `loupe_get_selection` |

Automated now: the deterministic loop, the on-page popover, axe in Standalone, and the full pull path (a real browser publishes a Connected-mode selection and a real MCP-over-HTTP client pulls it) all have passing tests. Still manual: a live LLM editing source then re-verifying. The dispatch composition per agent is unit-tested; the real spawn is opt-in (it edits files and spends tokens), gated behind `LOUPE_LIVE_DISPATCH`.

Cross-platform: Node, Playwright, and WebSocket only, with no OS-specific paths. Verified on macOS; not yet run on Windows.
