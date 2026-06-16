import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./mcp-server";
import { createSelectionStore, type SelectionStore } from "./selection-store";

export const DEFAULT_HTTP_PORT = 8792;

// A single user never has dozens of live agent sessions, so cap the map. This
// keeps a long-running daemon from accumulating dead sessions left by agents
// that dropped their connection without sending a DELETE.
const MAX_SESSIONS = 32;

// One long-running MCP endpoint over HTTP so any number of agents attach to the
// same daemon (and the same selection store) without each spawning their own
// process. This replaces the fragile stdio model where every agent spawned a
// serve that fought over the WS bridge's :8791. Bound to loopback only.
export function startHttpMcp(
  port: number = DEFAULT_HTTP_PORT,
  store: SelectionStore = createSelectionStore(),
): HttpServer {
  // One transport (and Server) per MCP session, routed by the mcp-session-id
  // header. Stateful sessions keep the initialize handshake alive across an
  // agent's calls; all sessions share the one store.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only local non-browser clients. A real agent's HTTP client sends no Origin;
    // any browser fetch attaches one, so this rejects drive-by and DNS-rebinding
    // requests to the local MCP endpoint, matching the WS bridge posture.
    if (req.headers.origin) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "origin not allowed" }, id: null }));
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "goldeye", mcp: "/mcp" }));
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;

    if (req.method === "POST") {
      const body = await readJson(req);
      let transport = sessionId ? sessions.get(sessionId) : undefined;
      if (!transport) {
        if (!isInitializeRequest(body)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "No session: send initialize first" },
              id: null,
            }),
          );
          return;
        }
        const fresh: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            if (sessions.size >= MAX_SESSIONS) {
              const oldest = sessions.keys().next().value;
              if (oldest) {
                const stale = sessions.get(oldest);
                sessions.delete(oldest);
                void stale?.close();
              }
            }
            sessions.set(id, fresh);
          },
        });
        fresh.onclose = () => {
          if (fresh.sessionId) sessions.delete(fresh.sessionId);
        };
        await createServer(store).connect(fresh);
        transport = fresh;
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sessionId ? sessions.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400).end();
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end();
  }

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e) }, id: null }));
      }
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

// Collect a JSON request body with a hard size cap so a local client cannot
// exhaust memory. Returns undefined for an empty body.
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 4_000_000) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
