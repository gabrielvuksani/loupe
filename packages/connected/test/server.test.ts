import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { analyzeElement, buildPacket } from "@goldeye/engine";
import { createServer } from "../src/mcp-server";
import { startBridge } from "../src/ws-bridge";
import { createSelectionStore } from "../src/selection-store";

const badButton = {
  selector: ".ghost",
  tag: "button",
  styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
};

function listeningPort(wss: ReturnType<typeof startBridge>): Promise<number> {
  return new Promise((resolve) => {
    const addr = wss.address();
    if (addr && typeof addr === "object") return resolve(addr.port);
    wss.once("listening", () => resolve((wss.address() as { port: number }).port));
  });
}

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

describe("MCP server · selection pull", () => {
  it("returns the element the Lens published, via goldeye_get_selection", async () => {
    const store = createSelectionStore();
    const server = createServer(store);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("goldeye_get_selection");

    const empty = await client.callTool({ name: "goldeye_get_selection", arguments: {} });
    expect((empty.content as Array<{ text: string }>)[0]?.text ?? "").toMatch(/no element/i);

    // the bridge writes the current selection into the shared store
    store.set(buildPacket(badButton, analyzeElement(badButton)));

    const res = await client.callTool({ name: "goldeye_get_selection", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/contrast/i);
    expect(text).toMatch(/\.ghost/);
    await client.close();
  });

  it("records an agent taste score and surfaces it in the selection", async () => {
    const store = createSelectionStore();
    const server = createServer(store);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    store.set(buildPacket(badButton, analyzeElement(badButton)));
    await client.callTool({
      name: "goldeye_score_taste",
      arguments: { score: 7, notes: "clean but cramped" },
    });

    const res = await client.callTool({ name: "goldeye_get_selection", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/Taste: 7\/10/);
    expect(text).toMatch(/clean but cramped/);
    await client.close();
  });

  it("flows a selection published over the WS bridge into MCP get_selection via one shared store", async () => {
    const store = createSelectionStore();
    const server = createServer(store);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const wss = startBridge(0, store);
    const port = await listeningPort(wss);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const packet = buildPacket(badButton, analyzeElement(badButton));

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "publish-selection", id: 1, packet })));
      ws.on("message", () => resolve());
      ws.on("error", reject);
    });

    const res = await client.callTool({ name: "goldeye_get_selection", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/contrast/i);
    expect(text).toMatch(/\.ghost/);

    await client.close();
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});

describe("WebSocket bridge", () => {
  it("returns engine findings for a streamed element", async () => {
    const wss = startBridge(0);
    const port = await listeningPort(wss);
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

  it("rejects a dispatch missing the project root with a helpful status", async () => {
    const wss = startBridge(0);
    const port = await listeningPort(wss);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const result = await new Promise<{ phase: string; message?: string }>((resolve, reject) => {
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "dispatch", id: 2, agent: "Claude Code", packet: {} })),
      );
      ws.on("message", (d) => resolve(JSON.parse(String(d))));
      ws.on("error", reject);
    });

    expect(result.phase).toBe("error");
    expect(result.message).toMatch(/project root/i);
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("rejects a connection from a web-page origin so a visited site cannot dispatch", async () => {
    const wss = startBridge(0);
    const port = await listeningPort(wss);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "https://evil.example" });

    const rejected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(false));
      ws.on("error", () => resolve(true));
      ws.on("unexpected-response", () => resolve(true));
    });

    expect(rejected).toBe(true);
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("allows the extension origin", async () => {
    const wss = startBridge(0);
    const port = await listeningPort(wss);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "chrome-extension://abc123" });

    const opened = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
    });

    expect(opened).toBe(true);
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
