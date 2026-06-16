import { runMcp } from "./mcp-server";
import { startBridge } from "./ws-bridge";

const mode = process.argv[2];

if (mode === "--bridge") {
  const wss = startBridge();
  const addr = wss.address();
  const port = typeof addr === "object" && addr ? addr.port : "?";
  // stderr so it never pollutes an MCP stdio stream
  console.error(`goldeye connected · WebSocket bridge on ws://localhost:${port}`);
} else {
  runMcp().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
