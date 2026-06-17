import { WebSocketServer, type WebSocket } from "ws";
import { analyzeElement, analyzePage, buildPacket, scoreFindings, type ElementPacket, type Finding } from "@loupe/engine";
import { createSelectionStore, type SelectionStore } from "./selection-store";
import { runDispatch, runBatchDispatch, gitDiffSummary, type AgentName } from "./agents";
import type { RenderProfile } from "./playwright-adapter";

// Forward an agent's live output to the extension as it runs, capped per
// dispatch so a chatty agent cannot flood the socket. The full output still
// arrives in the final result.
const STREAM_CAP = 100_000;
function streamSender(ws: WebSocket, id: unknown): (chunk: string) => void {
  let streamed = 0;
  return (chunk: string) => {
    if (streamed >= STREAM_CAP) return;
    const slice = chunk.slice(0, STREAM_CAP - streamed);
    streamed += slice.length;
    try {
      ws.send(JSON.stringify({ type: "dispatch-status", id, phase: "output", chunk: slice }));
    } catch {
      /* socket closed mid-stream */
    }
  };
}

// WebSocket bridge for the extension's Connected mode. Shares a selection store
// with the MCP server so the agent can pull what the browser published.
export function startBridge(
  port = 8791,
  store: SelectionStore = createSelectionStore(),
  token?: string,
): WebSocketServer {
  const wss = new WebSocketServer({
    port,
    host: "127.0.0.1",
    // Only the extension (chrome-extension://) or a local non-browser client
    // (no Origin header, e.g. tests) may connect. This rejects any visited web
    // page, which could otherwise drive the dispatch handler as a drive-by RCE.
    // When a token is set (opt-in via `serve --token`), the connection must also
    // carry a matching ?token= query: belt-and-suspenders against a local
    // non-browser actor.
    verifyClient: (info: { origin?: string; req?: { url?: string } }) => {
      const originOk = !info.origin || info.origin.startsWith("chrome-extension://");
      if (!originOk) return false;
      if (!token) return true;
      const query = (info.req?.url ?? "").split("?")[1] ?? "";
      return new URLSearchParams(query).get("token") === token;
    },
  });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data) => {
      let msg: {
        type?: string;
        id?: unknown;
        snapshot?: unknown;
        packet?: unknown;
        agent?: AgentName;
        cwd?: string;
        request?: string;
        findings?: unknown;
        url?: string;
        score?: number;
        profiles?: unknown;
      };
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }
      try {
        if (
          (msg.type === "analyze-element" || msg.type === "analyze-page") &&
          (typeof msg.snapshot !== "object" || msg.snapshot === null)
        ) {
          ws.send(JSON.stringify({ type: "error", id: msg.id, message: `${msg.type} needs a snapshot object` }));
          return;
        }
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
          const pageFindings = analyzePage(msg.snapshot as never);
          ws.send(
            JSON.stringify({
              type: "result",
              id: msg.id,
              findings: pageFindings,
              score: scoreFindings(pageFindings),
            }),
          );
        } else if (msg.type === "publish-selection") {
          store.set((msg.packet as ElementPacket | undefined) ?? null);
          if (typeof msg.request === "string" && msg.request.trim()) store.setRequest(msg.request);
          ws.send(JSON.stringify({ type: "ack", id: msg.id }));
        } else if (msg.type === "dispatch") {
          const { agent, packet, cwd } = msg;
          if (!agent || !packet || !cwd) {
            ws.send(
              JSON.stringify({
                type: "dispatch-status",
                id: msg.id,
                phase: "error",
                message: "dispatch needs agent, packet, and cwd (the project root)",
              }),
            );
          } else {
            const request = typeof msg.request === "string" && msg.request.trim() ? msg.request : undefined;
            if (request) store.setRequest(request);
            ws.send(JSON.stringify({ type: "dispatch-status", id: msg.id, phase: "dispatching", agent }));
            void runDispatch(agent, packet as ElementPacket, cwd, request, undefined, streamSender(ws, msg.id)).then(async (result) => {
              ws.send(
                JSON.stringify({
                  type: "dispatch-status",
                  id: msg.id,
                  phase: result.ok ? "applied" : "error",
                  result,
                }),
              );
              const diff = await gitDiffSummary(cwd);
              if (diff) {
                ws.send(JSON.stringify({ type: "dispatch-status", id: msg.id, phase: "diff", diff }));
              }
            });
          }
        } else if (msg.type === "dispatch-batch") {
          const { agent, findings, cwd } = msg;
          if (!agent || !Array.isArray(findings) || !cwd) {
            ws.send(
              JSON.stringify({
                type: "dispatch-status",
                id: msg.id,
                phase: "error",
                message: "dispatch-batch needs agent, a findings array, and cwd (the project root)",
              }),
            );
          } else {
            const request = typeof msg.request === "string" && msg.request.trim() ? msg.request : undefined;
            if (request) store.setRequest(request);
            const context = {
              url: typeof msg.url === "string" ? msg.url : undefined,
              score: typeof msg.score === "number" ? msg.score : undefined,
            };
            ws.send(JSON.stringify({ type: "dispatch-status", id: msg.id, phase: "dispatching", agent }));
            void runBatchDispatch(agent, findings as Finding[], cwd, request, context, undefined, streamSender(ws, msg.id)).then(async (result) => {
              ws.send(
                JSON.stringify({
                  type: "dispatch-status",
                  id: msg.id,
                  phase: result.ok ? "applied" : "error",
                  result,
                }),
              );
              const diff = await gitDiffSummary(cwd);
              if (diff) {
                ws.send(JSON.stringify({ type: "dispatch-status", id: msg.id, phase: "diff", diff }));
              }
            });
          }
        } else if (msg.type === "analyze-responsive") {
          if (!msg.url) {
            ws.send(JSON.stringify({ type: "error", id: msg.id, message: "analyze-responsive needs a url" }));
          } else {
            const url = msg.url;
            const profiles = Array.isArray(msg.profiles) ? (msg.profiles as RenderProfile[]) : undefined;
            ws.send(JSON.stringify({ type: "responsive-status", id: msg.id, phase: "rendering" }));
            // Lazy-load the Playwright adapter so the bridge module (and the unit
            // tests that import it) stay light; it only loads on a real request.
            void (async () => {
              try {
                const { renderProfiles } = await import("./playwright-adapter");
                const report = await renderProfiles(url, profiles);
                ws.send(JSON.stringify({ type: "responsive-result", id: msg.id, report }));
              } catch (e) {
                ws.send(JSON.stringify({ type: "error", id: msg.id, message: String(e) }));
              }
            })();
          }
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
