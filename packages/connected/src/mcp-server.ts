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
} from "@loupe/engine";
import { renderAndAnalyze, reverifyAfterFix, renderProfiles, type AppliedFix, type RenderProfile } from "./playwright-adapter";
import { createSelectionStore, type SelectionStore } from "./selection-store";

// loupe connected engine as an MCP server. The agent calls these from its own
// session; get_selection pulls whatever the Lens has selected in the browser.
export function createServer(store: SelectionStore = createSelectionStore()): Server {
  const server = new Server(
    { name: "loupe", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "loupe_get_selection",
        description:
          "Pull what the user selected in the loupe Lens: the element's findings and exact computed fixes, a unique selector to target it, its on-screen position, the accessible role and name, a cropped screenshot, the source file and line when a dev build exposes it, and the user's requested change. This is everything you need to make the edit without guessing which element. Call it first.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "loupe_score_taste",
        description:
          "Record your subjective 0-10 taste read for the current selection (typography, spacing, hierarchy, restraint). loupe stays deterministic; this is your judgment, surfaced as advisory.",
        inputSchema: {
          type: "object",
          properties: {
            score: { type: "number", description: "0 to 10." },
            notes: { type: "string", description: "One sentence of reasoning." },
          },
          required: ["score"],
        },
      },
      {
        name: "loupe_reverify",
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
        name: "loupe_analyze_url",
        description:
          "Render a URL in a real browser and return loupe deterministic findings + axe-core a11y + Lighthouse scores. Pass projectRoot to also grade the page against your authored design tokens in loupe.tokens.json.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to analyze." },
            projectRoot: {
              type: "string",
              description: "Optional repo root holding loupe.tokens.json, for a design-system check.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "loupe_analyze_element",
        description:
          "Run the deterministic engine on an element snapshot; returns the agent-pasteable packet (findings + computed fixes).",
        inputSchema: {
          type: "object",
          properties: { snapshot: { type: "object", description: "An ElementSnapshot." } },
          required: ["snapshot"],
        },
      },
      {
        name: "loupe_analyze_responsive",
        description:
          "Render a URL across viewport sizes and color schemes and report findings per profile plus the divergences between them. The headline is a contrast failure that appears only in dark mode, which a single light render misses. Omit profiles for the default desktop light/dark + phone matrix.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to render (your dev server)." },
            profiles: {
              type: "array",
              description: "Optional render profiles, each {name, viewport:{width,height}, colorScheme?, reducedMotion?}.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  viewport: {
                    type: "object",
                    properties: { width: { type: "number" }, height: { type: "number" } },
                    required: ["width", "height"],
                  },
                  colorScheme: { type: "string", enum: ["light", "dark", "no-preference"] },
                  reducedMotion: { type: "string", enum: ["reduce", "no-preference"] },
                },
                required: ["name", "viewport"],
              },
            },
          },
          required: ["url"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "loupe_score_taste") {
        const raw = Number(args["score"]);
        const score = Math.max(0, Math.min(10, Number.isFinite(raw) ? raw : 0));
        store.setTaste({ score, notes: String(args["notes"] ?? "") });
        return { content: [{ type: "text", text: `Recorded taste ${score}/10.` }] };
      }
      if (name === "loupe_get_selection") {
        const packet = store.get();
        if (!packet) {
          return {
            content: [{ type: "text", text: "No element is currently selected in the loupe Lens." }],
          };
        }
        const request = store.getRequest();
        const requestLine = request ? `\n\nUser request: ${request}` : "";
        const taste = store.getTaste();
        const tasteLine = taste
          ? `\n\nTaste: ${taste.score}/10 (agent)${taste.notes ? ` - ${taste.notes}` : ""}`
          : "";
        const content: Array<Record<string, unknown>> = [
          { type: "text", text: packetToMarkdown(packet) + requestLine + tasteLine },
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
      if (name === "loupe_reverify") {
        const fixes = args["fixes"] as AppliedFix[] | undefined;
        const report = await reverifyAfterFix(String(args["url"]), fixes);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }
      if (name === "loupe_analyze_url") {
        const root = args["projectRoot"] ? String(args["projectRoot"]) : undefined;
        const report = await renderAndAnalyze(String(args["url"]), root);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }
      if (name === "loupe_analyze_element") {
        const snap = args["snapshot"] as ElementSnapshot;
        const findings = analyzeElement(snap);
        return {
          content: [{ type: "text", text: packetToMarkdown(buildPacket(snap, findings)) }],
        };
      }
      if (name === "loupe_analyze_responsive") {
        const profiles = Array.isArray(args["profiles"]) ? (args["profiles"] as RenderProfile[]) : undefined;
        const report = await renderProfiles(String(args["url"]), profiles);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
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
