import { describe, it, expect } from "vitest";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { analyzeElement, buildPacket } from "@loupe/engine";
import { startHttpMcp } from "../src/http-mcp";
import { startBridge } from "../src/ws-bridge";
import { createSelectionStore } from "../src/selection-store";

const badButton = {
  selector: ".ghost",
  tag: "button",
  styles: { color: "rgb(174, 182, 194)", backgroundColor: "rgb(255, 255, 255)" },
};

function httpPort(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    const a = server.address();
    if (a && typeof a === "object") return resolve(a.port);
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
  });
}

// The WS bridge binds 127.0.0.1, so address() is null until the listening event.
function bridgePort(wss: ReturnType<typeof startBridge>): Promise<number> {
  return new Promise((resolve) => {
    const a = wss.address();
    if (a && typeof a === "object") return resolve(a.port);
    wss.once("listening", () => resolve((wss.address() as AddressInfo).port));
  });
}

async function connectClient(port: number): Promise<Client> {
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}

describe("HTTP MCP daemon", () => {
  it("carries a tool call over a real HTTP connection", async () => {
    const httpServer = startHttpMcp(0);
    const port = await httpPort(httpServer);
    const client = await connectClient(port);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("loupe_get_selection");

    const res = await client.callTool({
      name: "loupe_analyze_element",
      arguments: { snapshot: badButton },
    });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/contrast/i);

    await client.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("flows a Lens selection published over WS into an agent's HTTP MCP get_selection", async () => {
    // One shared store, two separate processes-in-spirit: the browser's WS bridge
    // and the agent's HTTP MCP endpoint. This is the headline pull flow, proven
    // across two real socket connections rather than one in-process seam.
    const store = createSelectionStore();
    const httpServer = startHttpMcp(0, store);
    const port = await httpPort(httpServer);
    const wss = startBridge(0, store);
    const wsPort = await bridgePort(wss);

    const client = await connectClient(port);

    const empty = await client.callTool({ name: "loupe_get_selection", arguments: {} });
    expect((empty.content as Array<{ text: string }>)[0]?.text ?? "").toMatch(/no element/i);

    // the Lens publishes the current selection over the WS bridge
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    const packet = buildPacket(badButton, analyzeElement(badButton));
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "publish-selection", id: 1, packet })));
      ws.on("message", () => resolve());
      ws.on("error", reject);
    });

    // the agent pulls it from its own HTTP MCP session
    const res = await client.callTool({ name: "loupe_get_selection", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/contrast/i);
    expect(text).toMatch(/\.ghost/);

    await client.close();
    ws.close();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("rejects a request that carries a browser Origin header", async () => {
    const httpServer = startHttpMcp(0);
    const port = await httpPort(httpServer);

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
    });
    expect(res.status).toBe(403);

    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("answers a health check so users can confirm the daemon is up", async () => {
    const httpServer = startHttpMcp(0);
    const port = await httpPort(httpServer);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; service?: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("loupe");

    await new Promise<void>((r) => httpServer.close(() => r()));
  });
});
