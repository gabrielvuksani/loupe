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
import { renderAndAnalyze } from "./playwright-adapter";

// goldeye connected engine as an MCP server.
export function createServer(): Server {
  const server = new Server(
    { name: "goldeye", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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

export async function runMcp(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
