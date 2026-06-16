# loupe

loupe is a magnifier for your interface. Point it at any page and it tells you, precisely and without asking a language model to guess, what is wrong with the design and the accessibility, and the exact change that fixes it. Then it hands that to the coding agent you already use and checks the result.

The detection is deterministic. A weak local model and a frontier model see the same findings, because no model produced them. The AI only does the part that genuinely needs a mind: editing your source, and the occasional question of taste.

## The idea

Most design tooling either lints your CSS in the abstract or shows you a contrast number and leaves the rest to you. loupe does the whole loop: it renders the page, judges it against fixed rules (WCAG contrast, tap-target size, type scale, spacing rhythm, palette restraint, and a dozen more), computes the specific property change that resolves each finding, lets your agent apply it, then re-renders and re-judges so you can watch the score climb.

Because the judging is rules, not vibes, it works on pages you do not own. It reads the page's own system out of the values it actually uses, grades that against universal invariants, and only then, if you want, against a canonical system you authored.

## Two ways to run it

**Standalone.** The engine runs entirely inside the page. Inspect any element for a verdict and a fix, or scan the whole page for a health report. It is free, offline, and nothing leaves the tab. axe-core rides along for a real accessibility pass.

**Connected.** The Lens talks to a small local daemon over a loopback socket, and your coding agent attaches to that same daemon over MCP. You select an element, say what you want, and the agent makes the change in your repo and re-verifies. No credentials leave your machine, because the model is the one you are already running.

## Quick start

Three pieces: the daemon, the extension, and your agent.

**1. Run the daemon.**

```
npx loupe-cli serve
```

That starts the WebSocket bridge on `ws://127.0.0.1:8791` for the browser and an MCP endpoint on `http://127.0.0.1:8792/mcp` for your agent. Leave it running. (Prefer a global install? `npm i -g loupe-cli`, then `loupe serve`.)

The render tools (`loupe_analyze_url`, `loupe_reverify`) drive a real Chromium through Playwright. The first time you use one, install the browser once: `npx playwright install chromium`. Plain `loupe serve` and the pull flow do not need it.

**2. Load the Lens.**

```
pnpm --filter @loupe/extension build
```

Open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and point it at `packages/extension/.output/chrome-mv3`. Click the toolbar icon to open the side panel.

**3. Connect your agent.** See below.

## Connect your coding agent

Register the running daemon once. loupe speaks the modern streamable-HTTP MCP transport, so one daemon serves every agent at the same time.

**Claude Code**

```
claude mcp add --transport http loupe http://127.0.0.1:8792/mcp
```

**Codex** (streamable HTTP only; Codex dropped SSE)

```
codex mcp add loupe --url http://127.0.0.1:8792/mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.loupe]
url = "http://127.0.0.1:8792/mcp"
```

**OpenCode** in `opencode.json` (your project root, or `~/.config/opencode/`):

```jsonc
{
  "mcp": {
    "loupe": { "type": "remote", "url": "http://127.0.0.1:8792/mcp", "enabled": true }
  }
}
```

Once it is registered, your agent has tools named `loupe_get_selection`, `loupe_reverify`, `loupe_analyze_url`, `loupe_analyze_element`, and `loupe_score_taste`.

## The loop, in practice

Switch the Lens to Connected and inspect an element. Now you have two ways to drive it.

**Tell loupe what you want.** Type the change into the panel ("make this the primary button", "tighten the line length", "give it a hover state") and hit Send. loupe ships the element context and your request to the agent, which makes the change in your repo and re-verifies.

**Or ask your agent directly.** Leave your terminal session open and say "loupe, fix what I just selected." The agent calls `loupe_get_selection` and pulls everything itself. Same context, your choice of driver.

Either way, the agent is not guessing which element you meant. `loupe_get_selection` returns:

- a unique selector that targets that exact element, not the first match of a short class
- where it sits on screen, in pixels
- its accessible role and name
- the source file and line, when a dev build exposes it
- a cropped screenshot for models that can see
- every finding with the precise computed fix
- and the change you asked for, in your words

That is enough for a small model to act without a single ambiguous step.

## What loupe checks

Deterministic, in the engine:

- **Contrast.** WCAG ratio, with a hue-preserving OKLCH fix and an APCA reading alongside it.
- **Tap targets.** Below 44px gets flagged, with inline text links correctly exempted per WCAG 2.5.5.
- **Type.** Scale ratios, the number of distinct sizes, font families, and weights.
- **Rhythm.** Spacing snapped to a 4px grid, comfortable line length.
- **Palette.** Total color count, competing accent hues, and a single accent stuck at one flat shade.
- **Color vision.** Color pairs that look distinct to you but collapse under red-green or blue-yellow color blindness, with a page overlay to see it for yourself.
- **Semantics.** A generic element wearing an interactive role that should be the real tag.
- **Keyboard.** A positive tabindex that forces a brittle manual tab order instead of the natural one.
- **Responsive.** Horizontal overflow at phone, tablet, and desktop widths, naming the elements that spill past the edge.
- **Cross-browser.** Used CSS properties checked against your browserslist targets.
- **Design system.** Drop a `loupe.tokens.json` in your repo and any font size or color off your authored scale is flagged, with the nearest token as the fix.

Plus axe-core for accessibility in Standalone, and Lighthouse scores in Connected. The closed loop also gives you a pixel-level before/after visual delta on re-verify.

A zero-false-positive guard test runs on every rule, because a linter that cries wolf is worse than no linter. We learned that out loud: an early build flagged 59 "too small" tap targets on Hacker News that were all inline links, and a beautifully built site like Stripe scored far lower than it should have. The inline-link exemption fixed both without letting real issues through.

## Run it from source

```
pnpm install          # everything, including Playwright's Chromium
pnpm test             # the fast unit suite
pnpm test:integration # real browser: render, axe, Lighthouse, and the loaded extension
```

Three packages:

| Package | What it is |
|---|---|
| `packages/engine` | Pure detection and fix computation. No DOM, no AI, every rule a small unit. |
| `packages/extension` | The Lens. A WXT MV3 extension that runs the engine in the page. |
| `packages/connected` | The daemon. Playwright, axe-core, and Lighthouse behind an MCP server and a WebSocket bridge. Published to npm as `loupe-cli`. |

## How it is verified

| Layer | How |
|---|---|
| Engine rules and fixes | unit tests, including the zero-false-positive guard |
| MCP and the bridge | in-memory and over-HTTP MCP round-trips, plus a live WebSocket round-trip |
| Real render | a fixture rendered in real Chromium returns findings and a numeric Lighthouse score |
| The closed loop | a computed contrast fix applied to a live render, re-judged, the finding gone and the score up |
| Pull flow end to end | the built extension in headed Chromium publishes a selection and a request, and a real MCP-over-HTTP client pulls both (gated behind `LOUPE_LIVE_PULL`) |

Honest about the edges: the deterministic loop, the on-page popover, axe in Standalone, and the full pull path all have passing tests. A live model editing your source and re-verifying is opt-in (it spends tokens and touches files), gated behind `LOUPE_LIVE_DISPATCH`, and has been run by hand with Claude Code. Verified on macOS; not yet on Windows.

## Security

The bridge binds loopback and accepts only `chrome-extension://` origins, so a page you visit cannot drive it. The MCP endpoint rejects any request that carries a browser `Origin` header. The render guard refuses non-http(s) URLs and resolves hostnames to block link-local and cloud-metadata addresses, while still allowing your `localhost` and LAN dev servers. For a belt and suspenders, `loupe serve --token` prints a one-time token the bridge then requires.

## License

MIT.
