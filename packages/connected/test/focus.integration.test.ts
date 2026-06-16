import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { renderAndAnalyze } from "../src/playwright-adapter";

// .bad kills its focus outline with nothing in its place; .good draws a real
// :focus-visible ring. A keyboard user can see .good but not .bad, and the probe
// must tell them apart, since :focus-visible only matches under keyboard focus.
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>focus</title>
<style>
  button { font-size: 16px; padding: 12px 20px; margin: 10px; border: 0; }
  .bad:focus { outline: none; }
  .good:focus-visible { outline: 3px solid #2563eb; }
</style></head><body>
  <button class="good">Save</button>
  <button class="bad">Delete</button>
</body></html>`;

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("connected · focus-visible probe (real keyboard navigation)", () => {
  it(
    "flags the control with no focus ring but not the one with a :focus-visible ring",
    async () => {
      const report = await renderAndAnalyze(base);
      const focus = report.findings.filter((f) => f.ruleId === "focus-visible");
      expect(focus.some((f) => f.selector.includes("bad"))).toBe(true);
      expect(focus.some((f) => f.selector.includes("good"))).toBe(false);
    },
    180000,
  );
});
