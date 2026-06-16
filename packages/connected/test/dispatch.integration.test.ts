import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { buildPacket, type ElementSnapshot, type Finding } from "@goldeye/engine";
import { renderAndAnalyze } from "../src/playwright-adapter";
import { runDispatch, type AgentName } from "../src/agents";

// Gated, real-agent end-to-end test. Skipped by default; it spawns a coding
// agent that edits files and spends tokens. Run it manually:
//
//   GOLDEYE_LIVE_DISPATCH=1 GOLDEYE_AGENT=Codex pnpm test:integration dispatch
//
// The fixture has a real contrast problem in styles.css (#aeb6c2 on white).
// We render it, hand the engine-computed contrast fix to the agent pointed at
// the fixture cwd, then re-render and assert the contrast finding cleared.

const LIVE = process.env.GOLDEYE_LIVE_DISPATCH === "1";
const AGENT = (process.env.GOLDEYE_AGENT as AgentName) || "Codex";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dispatch-app");
const cssPath = join(fixtureDir, "styles.css");

// Minimal static server scoped to the fixture dir, normalized to block traversal.
function staticServer(root: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const rel = (req.url === "/" || !req.url ? "/index.html" : req.url).split("?")[0]!;
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    const type = file.endsWith(".css") ? "text/css" : "text/html";
    res.setHeader("content-type", type);
    createReadStream(file)
      .on("error", () => {
        res.statusCode = 404;
        res.end("not found");
      })
      .pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}/` });
    });
  });
}

let server: Server;
let base = "";
let originalCss = "";

beforeAll(async () => {
  originalCss = await readFile(cssPath, "utf8");
  ({ server, base } = await staticServer(fixtureDir));
});

afterAll(async () => {
  // Restore the fixture so the agent's real edit does not persist.
  if (originalCss) await writeFile(cssPath, originalCss, "utf8");
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe.skipIf(!LIVE)("connected · live dispatch closes the contrast finding (gated)", () => {
  it(
    "renders, dispatches the engine-computed contrast fix to a real agent, and the finding clears",
    async () => {
      const before = await renderAndAnalyze(base);
      const contrast = before.findings.find((f) => f.ruleId === "contrast" && f.fix);
      expect(contrast, "fixture should render a fixable contrast finding").toBeDefined();

      // Point the finding at the real source file so the agent knows what to edit.
      const finding: Finding = { ...contrast!, selector: ".ghost" };
      const snapshot: ElementSnapshot = {
        selector: ".ghost",
        tag: "button",
        text: "Watch the tour",
        styles: { color: "#aeb6c2", backgroundColor: "#ffffff" },
        source: { file: cssPath },
      };
      const packet = buildPacket(snapshot, [finding]);

      const result = await runDispatch(AGENT, packet, fixtureDir);
      expect(result.ok, `agent dispatch failed: ${result.stderr}`).toBe(true);

      const after = await renderAndAnalyze(base);
      expect(after.findings.some((f) => f.ruleId === "contrast")).toBe(false);
      expect(after.score.overall).toBeGreaterThan(before.score.overall);
    },
    600000,
  );
});
