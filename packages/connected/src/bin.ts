import { runMcp } from "./mcp-server";
import { startBridge } from "./ws-bridge";
import { createSelectionStore } from "./selection-store";

const mode = process.argv[2];
const store = createSelectionStore();

function launchBridge(): void {
  const wss = startBridge(8791, store);
  wss.on("error", (e: unknown) => console.error(`goldeye · bridge error: ${String(e)}`));
  wss.on("listening", () =>
    console.error("goldeye · WebSocket bridge on ws://localhost:8791"),
  );
}

if (mode === "--bridge") {
  launchBridge();
} else if (mode === "--serve") {
  // One process: the WS bridge for the browser and the stdio MCP server for the
  // agent, sharing one selection store. This is what makes the agent able to
  // pull what the Lens selected.
  launchBridge();
  runMcp(store).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runMcp(store).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
