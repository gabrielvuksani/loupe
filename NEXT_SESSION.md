# loupe next session: close every gap, autonomously

> Status 2026-06-16: effectively complete. The loop, pull-MCP dispatch, popover,
> expanded packet, axe in Standalone, OKLCH + APCA, the agent taste seam, the taste
> rules (spacing-scale, line-length, semantic-tag, color-count), the cross-browser rule
> (browser-compat-data + browserslist + projectwallace), the pixelmatch visual delta,
> the ADR, and a live agent-applies-then-reverify e2e (run with Claude Code) are all done
> and green, plus accent-spread and shades-per-color (built from a new per-color
> frequency capture). Only hierarchy levers is left as a standalone rule, and its intent
> is already covered by type-scale, font-weights, and color-count. See HANDOFF.md.
>
> Update 2026-06-16 (daemon session): productization (a standalone `loupe serve` esbuild
> bundle, MCP registration docs for all three agents, CI), the full pull flow proven with a
> real browser plus a real MCP-over-HTTP client, SSRF + an optional WS token, and a real-site
> validation that drove a target-size false-positive fix are all done. Ready for the PR to main.

Mandate: complete this whole list end to end without checking in. The v0 substrate
(engine, connected, extension) is built and green. This pass closes the gaps the
last session deferred, most importantly the closed loop and the live dispatch.
Work top down by priority so the highest-value items land first. Report straight at
the end, gap list first, no victory lap.

## Standards (do not skip)
- TDD: one behavior, one test, RED then GREEN. Test behavior, not algorithm.
- The zero-false-positive guard test stays green for every new engine rule.
- Ship working out of the box: real installed deps, no lazy fallbacks, verify by running it.
- No em dashes anywhere. Terse comments or none. No marketing tone.
- Verify before claiming done. Run it. Honest final report, gaps first.
- Cross-platform: Node, Playwright, WebSocket only. No bash-only snippets in docs.
- Keep the engine pure and DOM-free. New rules are pure functions over a snapshot.

## Work, in priority order

Each item lists goal, files, approach, done-when.

### 1. Close the loop (the moat). HIGHEST PRIORITY.
Goal: render, judge, fix, re-judge actually works.
- Files: packages/connected/src/mcp-server.ts, packages/connected/src/playwright-adapter.ts (or a new reverify.ts).
- Add a connected function `reverifyAfterFix(url, fixes)` that applies the computed CSS fixes to the rendered page (inline style or addStyleTag), re-runs the engine, and returns before and after scores.
- Add MCP tools `loupe_apply_fix` and `loupe_reverify`.
- Done when: an integration test applies a computed contrast fix to the fixture, re-verifies, the contrast finding is gone, and the score rose.

### 2. Live element to agent dispatch (Connected). The thing the user cares about most.
Goal: "Send to {agent}" actually dispatches to the chosen CLI agent.
- Files: packages/connected/src/ws-bridge.ts, new packages/connected/src/agents.ts, extension sidepanel/main.ts.
- ws-bridge: handle `{type:"dispatch", agent, packet}`. Compose the prompt from packetToMarkdown and invoke the CLI agent headlessly in the target repo cwd: Claude Code via `claude -p` or the Agent SDK, Codex via `codex exec`, OpenCode via its SDK or CLI. Stream status back over the WS.
- agents.ts: `dispatch(agent, packet, cwd)` returns the command result.
- Note: OpenCode plus Claude needs an API key (Anthropic blocked OAuth in Jan 2026).
- Done when: a test shows dispatch composes the right command per agent and returns output, or a documented manual run does. The button is not a no-op.

### 3. The on-page inspector popover (the "both, one gesture" spine the user chose).
Goal: one click on an element shows the verdict and dispatch in place on the page, and the side panel reacts together.
- Reference design: prototypes/03-lens-extension.html (popover, glass, gold). On disk, gitignored.
- Files: packages/extension/entrypoints/content.ts.
- On element click: render a popover overlay near the element inside a shadow root (so page CSS does not bleed), showing the element verdict, fixes, and Send / Copy / Preview actions. Also send element-result to the side panel so both react to the one gesture.
- Done when: a loaded-extension e2e clicks an element and asserts the popover exists and the panel updated.

### 4. Expand the element packet, including a screenshot.
Goal: the rich packet the user asked for ("should we have a screenshot as well?").
- Files: packages/engine/src/types.ts, capture.ts, packet.ts; connected playwright-adapter.ts; extension content.ts + background.ts.
- Extend the snapshot and packet with: cropped screenshot (data URL), outerHTML (trimmed), a wider computed-styles subset, accessibility node {role, name, state}, and source {file, line} when available.
- Capture: extension uses chrome.tabs.captureVisibleTab in the background then crops to the box; connected uses page.screenshot({clip}). a11y from ARIA role and accessible name. source via element-source on dev builds.
- packetToMarkdown references the new fields. Add tests for presence.
- Done when: buildPacket includes screenshot plus a11y node; connected analyze_url attaches element screenshots; tests assert it.

### 5. axe-core in Standalone.
Goal: standalone runs real a11y in-page, not only the engine rules.
- Files: packages/extension/entrypoints/content.ts (bundle axe-core), a mapper to Finding[].
- Run axe.run() on the page or element, map violations to Finding[], merge with engine findings.
- Done when: the loaded-extension e2e finds an axe-sourced rule id in standalone.

### 6. Adopt the libraries committed to last session.
- culori: refactor minimalAccessibleColor to an OKLCH lightness search. Engine tests stay green (they assert behavior).
- @mdn/browser-compat-data + browserslist: a cross-browser standalone rule that flags used CSS features unsupported in the target set. New engine rule, test-first.
- @projectwallace/css-analyzer: page-level taste signals (color, font, size counts, specificity) feeding analyzePage. Test-first.
- pixelmatch: visual diff for the re-verify step (before and after screenshots).
- APCA via Color.js or apcach: a perceptual taste signal alongside WCAG.
- Done when: each is installed and used by code with a test or a verified run. No dead deps.

### 7. Full Refactoring-UI taste rules plus the subjective AI layer.
- Engine rules, each test-first, zero-FP guard green: spacing-scale membership, line-length 45 to 75 chars, accent-color count (60-30-10), hierarchy levers (combine not multiply), semantic-tag vs visual-role, shades-per-color.
- Subjective layer: expose a tasteCritic seam; in Connected, produce a 0 to 10 taste score via the CLI agent or a model call. Engine stays deterministic; the AI score is layered in connected only.
- Done when: the rule count roughly matches the codified Refactoring-UI set, and the AI taste score appears in connected reports.

### 8. Candidis merge (the user wanted to merge with the prior vm-browser idea).
- Evaluate ~/Projects/vm-browser for reusable pieces: Cloudflare browser-rendering for a cloud connected option, the agent-protocols router.
- Either wire a cloud connected mode via Cloudflare Browser Run, or write a short ADR in docs explaining why not now.
- Done when: a cloud connected option exists, or an ADR records the decision.

### 9. Verify the full UX and cross-platform.
- e2e the inspect-element path (not only scan), the popover, the dispatch composition, and the apply plus re-verify loop.
- Fix docs for Windows (no `$(pwd)`); keep the headed-Chromium note for extension tests.
- Done when: the loop and the inspect flow have passing tests, and the report separates automated from manual clearly.

## Out of scope this pass (tracked, not now)
- Greenfield app-maker (the Lovable twist), a later face on the engine.
- Conductor redesign (the user rejected the prototype design); rebuild later.

## Definition of done for the pass
In a loaded browser: click an element, see the verdict popover in place, dispatch
to a CLI agent, the agent applies, loupe re-verifies, and the score climbs.
Standalone runs axe plus the full deterministic taste set. Every committed dep is
used. Tests cover the loop and the inspect flow. The final report leads with what
still is not done.
