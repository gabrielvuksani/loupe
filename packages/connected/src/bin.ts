import { randomUUID } from "node:crypto";
import { runMcp } from "./mcp-server";
import { startBridge } from "./ws-bridge";
import { startHttpMcp, DEFAULT_HTTP_PORT } from "./http-mcp";
import { createSelectionStore } from "./selection-store";
import { installExtension } from "./extension-install";

const mode = process.argv[2];
const store = createSelectionStore();

// Opt-in via `serve --token`: the bridge then requires a matching ?token= from
// the Lens. Off by default so Connected mode works with no extra step.
const token = process.argv.includes("--token") ? randomUUID() : undefined;

// All logs go to stderr: in stdio MCP mode stdout is the protocol channel.
function launchBridge(): void {
  const wss = startBridge(8791, store, token);
  wss.on("error", (e: unknown) => console.error(`loupe · bridge error: ${String(e)}`));
  wss.on("listening", () => {
    console.error("loupe · WebSocket bridge on ws://127.0.0.1:8791");
    if (token) console.error(`loupe · bridge token (paste into the Lens panel): ${token}`);
  });
}

function launchHttpMcp(): void {
  const server = startHttpMcp(DEFAULT_HTTP_PORT, store);
  server.on("error", (e: unknown) => console.error(`loupe · http mcp error: ${String(e)}`));
  server.on("listening", () =>
    console.error(`loupe · MCP over HTTP on http://127.0.0.1:${DEFAULT_HTTP_PORT}/mcp`),
  );
}

if (mode === "--bridge") {
  launchBridge();
} else if (mode === "--mcp") {
  runMcp(store).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
} else if (mode === "serve" || mode === "--serve") {
  // The daemon: one process the user runs once. The browser connects to the WS
  // bridge; every agent attaches to the HTTP MCP endpoint. They share one store,
  // so an agent pulls exactly what the Lens selected. Run once, attach many.
  launchBridge();
  launchHttpMcp();
} else if (mode === "extension") {
  // Unpack the bundled Lens to a folder the user loads in Chrome, so the
  // extension is one `npx loupe-cli extension` away with no repo clone or build.
  const i = process.argv.indexOf("--dir");
  const target = i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : "loupe-extension";
  const result = installExtension(target);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`\nLoupe extension written to:\n  ${result.dir}\n`);
  console.log("Load it in Chrome:");
  console.log("  1. Open chrome://extensions");
  console.log("  2. Turn on Developer mode (top right)");
  console.log("  3. Click 'Load unpacked' and select the folder above");
  console.log("  4. Click the Loupe icon to open the side panel\n");
} else {
  // Back-compat bare invocation: speak stdio MCP for `... add --transport stdio`.
  runMcp(store).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
