import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  analyzeElement,
  buildPacket,
  packetToMarkdown,
  type ElementSnapshot,
} from "@goldeye/engine";
import { renderAndAnalyze, reverifyAfterFix, type AppliedFix } from "./playwright-adapter";
import { createSelectionStore, type SelectionStore } from "./selection-store";

// goldeye connected engine as an MCP server. The agent calls these from its own
// session; get_selection pulls whatever the Lens has selected in the browser.
export function createServer(store: SelectionStore = createSelectionStore()): Server {
  const server = new Server(
    { name: "goldeye", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "goldeye_get_selection",
        description:
          "Pull the element currently selected in the goldeye Lens: its findings, computed fixes, and source hint. Call this to act on what the user picked in the browser.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "goldeye_reverify",
        description:
          "Re-judge a URL and report the before/after score. Omit fixes for a deterministic self-heal proof; pass an empty fixes array to re-judge the live page after you edited the source.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to re-judge (your dev server)." },
            fixes: {
              type: "array",
              description: "Optional explicit fixes [{selector, property, to}] applied to the render.",
              items: {
                type: "object",
                properties: {
                  selector: { type: "string" },
                  property: { type: "string" },
                  to: { type: "string" },
                },
                required: ["selector", "property", "to"],
              },
            },
          },
          required: ["url"],
        },
      },
      {
        name: "goldeye_analyze_url",
        description:
          "Render a URL in a real browser and return goldeye deterministic findings + axe-core a11y + Lighthouse scores.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", description: "The URL to analyze." } },
          required: ["url"],
        },
      },
      {
        name: "goldeye_analyze_element",
        description:
          "Run the deterministic engine on an element snapshot; returns the agent-pasteable packet (findings + computed fixes).",
        inputSchema: {
          type: "object",
          properties: { snapshot: { type: "object", description: "An ElementSnapshot." } },
          required: ["snapshot"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "goldeye_get_selection") {
        const packet = store.get();
        if (!packet) {
          return {
            content: [{ type: "text", text: "No element is currently selected in the goldeye Lens." }],
          };
        }
        const content: Array<Record<string, unknown>> = [
          { type: "text", text: packetToMarkdown(packet) },
        ];
        const shot = packet.screenshot;
        if (typeof shot === "string" && shot.startsWith("data:image/")) {
          const comma = shot.indexOf(",");
          const semi = shot.indexOf(";");
          if (comma > 0) {
            content.push({
              type: "image",
              data: shot.slice(comma + 1),
              mimeType: semi > 0 ? shot.slice(5, semi) : "image/png",
            });
          }
        }
        return { content };
      }
      if (name === "goldeye_reverify") {
        const fixes = args["fixes"] as AppliedFix[] | undefined;
        const report = await reverifyAfterFix(String(args["url"]), fixes);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }
      if (name === "goldeye_analyze_url") {
        const report = await renderAndAnalyze(String(args["url"]));
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }
      if (name === "goldeye_analyze_element") {
        const snap = args["snapshot"] as ElementSnapshot;
        const findings = analyzeElement(snap);
        return {
          content: [{ type: "text", text: packetToMarkdown(buildPacket(snap, findings)) }],
        };
      }
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  });

  return server;
}

export async function runMcp(store?: SelectionStore): Promise<void> {
  await createServer(store).connect(new StdioServerTransport());
}
