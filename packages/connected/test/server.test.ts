import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp-server";
import { startBridge } from "../src/ws-bridge";

const badButton = {
  selector: ".ghost",
  tag: "button",
  styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
};

describe("MCP server", () => {
  it("lists tools and analyzes an element over the protocol", async () => {
    const server = createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("goldeye_analyze_element");

    const res = await client.callTool({
      name: "goldeye_analyze_element",
      arguments: { snapshot: badButton },
    });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/contrast/i);
    await client.close();
  });
});

describe("WebSocket bridge", () => {
  it("returns engine findings for a streamed element", async () => {
    const wss = startBridge(0);
    const port = (wss.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const result = await new Promise<{ findings: Array<{ ruleId: string }> }>((resolve, reject) => {
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "analyze-element", id: 1, snapshot: badButton })),
      );
      ws.on("message", (d) => resolve(JSON.parse(String(d))));
      ws.on("error", reject);
    });

    expect(result.findings.some((f) => f.ruleId === "contrast")).toBe(true);
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
