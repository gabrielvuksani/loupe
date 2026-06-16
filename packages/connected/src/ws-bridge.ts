import { WebSocketServer, type WebSocket } from "ws";
import { analyzeElement, analyzePage, buildPacket } from "@goldeye/engine";

// WebSocket bridge for the extension's Connected mode.
export function startBridge(port = 8791): WebSocketServer {
  const wss = new WebSocketServer({ port });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data) => {
      let msg: { type?: string; id?: unknown; snapshot?: unknown };
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
