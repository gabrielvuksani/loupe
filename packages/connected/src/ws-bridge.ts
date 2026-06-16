import { WebSocketServer, type WebSocket } from "ws";
import { analyzeElement, analyzePage, buildPacket, type ElementPacket } from "@goldeye/engine";
import { createSelectionStore, type SelectionStore } from "./selection-store";

// WebSocket bridge for the extension's Connected mode. Shares a selection store
// with the MCP server so the agent can pull what the browser published.
export function startBridge(
  port = 8791,
  store: SelectionStore = createSelectionStore(),
): WebSocketServer {
  const wss = new WebSocketServer({ port });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data) => {
      let msg: { type?: string; id?: unknown; snapshot?: unknown; packet?: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }
      try {
        if (msg.type === "analyze-element") {
          const findings = analyzeElement(msg.snapshot as never);
          ws.send(
            JSON.stringify({
              type: "result",
              id: msg.id,
              findings,
              packet: buildPacket(msg.snapshot as never, findings),
            }),
          );
        } else if (msg.type === "analyze-page") {
          ws.send(
            JSON.stringify({ type: "result", id: msg.id, findings: analyzePage(msg.snapshot as never) }),
          );
        } else if (msg.type === "publish-selection") {
          store.set((msg.packet as ElementPacket | undefined) ?? null);
          ws.send(JSON.stringify({ type: "ack", id: msg.id }));
        } else {
          ws.send(JSON.stringify({ type: "error", id: msg.id, message: `unknown type: ${msg.type}` }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", id: msg.id, message: String(e) }));
      }
    });
  });
  return wss;
}
