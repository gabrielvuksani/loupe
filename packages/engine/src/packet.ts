import type { ComputedFix, ElementSnapshot, Finding } from "./types";
import { scoreFindings } from "./score";

// The context packet for one element: snapshot plus findings, fixes, and score.
export interface ElementPacket {
  selector: string;
  uniqueSelector?: string;
  tag: string;
  text?: string;
  styles: ElementSnapshot["styles"];
  box?: ElementSnapshot["box"];
  a11y?: ElementSnapshot["a11y"];
  source?: ElementSnapshot["source"];
  outerHTML?: string;
  screenshot?: string;
  findings: Finding[];
  fixes: ComputedFix[];
  score: number;
}

export function buildPacket(snapshot: ElementSnapshot, findings: Finding[]): ElementPacket {
  const packet: ElementPacket = {
    selector: snapshot.selector,
    tag: snapshot.tag,
    styles: snapshot.styles,
    findings,
    fixes: findings
      .map((f) => f.fix)
      .filter((x): x is ComputedFix => x !== undefined),
    score: scoreFindings(findings).overall,
  };
  if (snapshot.uniqueSelector !== undefined) packet.uniqueSelector = snapshot.uniqueSelector;
  if (snapshot.text !== undefined) packet.text = snapshot.text;
  if (snapshot.box !== undefined) packet.box = snapshot.box;
  if (snapshot.a11y !== undefined) packet.a11y = snapshot.a11y;
  if (snapshot.source !== undefined) packet.source = snapshot.source;
  if (snapshot.outerHTML !== undefined) packet.outerHTML = snapshot.outerHTML;
  if (snapshot.screenshot !== undefined) packet.screenshot = snapshot.screenshot;
  return packet;
}

// Render a whole page audit as one agent-pasteable batch. Findings are grouped
// by selector so a small model fixes one element at a time, each with its exact
// computed fix. This is the "fix everything" packet, the page-level analog of
// packetToMarkdown.
export function findingsToMarkdown(
  findings: readonly Finding[],
  context?: { url?: string; score?: number },
): string {
  const lines: string[] = [`## loupe · page audit${context?.url ? ` · ${context.url}` : ""}`];
  const score = context?.score !== undefined ? ` · score ${context.score}/100` : "";
  lines.push(`${findings.length} finding(s)${score}`, "");

  const bySelector = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = bySelector.get(f.selector);
    if (group) group.push(f);
    else bySelector.set(f.selector, [f]);
  }
  for (const [selector, group] of bySelector) {
    lines.push(`### \`${selector}\``);
    for (const f of group) {
      lines.push(`- **[${f.severity}/${f.category}] ${f.ruleId}**: ${f.message}`);
      if (f.fix) {
        lines.push(`  - fix: \`${f.fix.property}\` ${f.fix.from} → ${f.fix.to} (${f.fix.rationale})`);
      }
    }
  }
  return lines.join("\n");
}

// Render a packet as agent-pasteable Markdown. Leads with what + where + how to
// target the element so even a small model acts without guessing.
export function packetToMarkdown(packet: ElementPacket): string {
  const lines: string[] = [`## loupe · ${packet.tag} \`${packet.selector}\``];
  if (packet.text) lines.push(`> "${packet.text}"`);
  if (packet.box) {
    const size = `${Math.round(packet.box.width)}x${Math.round(packet.box.height)}px`;
    const at =
      packet.box.x !== undefined && packet.box.y !== undefined
        ? ` at viewport (${Math.round(packet.box.x)}, ${Math.round(packet.box.y)})`
        : "";
    lines.push(`${size}${at}`);
  }
  if (packet.uniqueSelector) lines.push(`target: \`${packet.uniqueSelector}\``);
  if (packet.a11y) {
    const name = packet.a11y.name ? ` · name: "${packet.a11y.name}"` : "";
    lines.push(`role: ${packet.a11y.role}${name}`);
  }
  if (packet.source) {
    const line = packet.source.line ? `:${packet.source.line}` : "";
    lines.push(`source: ${packet.source.file}${line}`);
  }
  lines.push(`Score: ${packet.score}/100 · ${packet.findings.length} finding(s)`, "");
  for (const f of packet.findings) {
    lines.push(`- **[${f.severity}/${f.category}] ${f.ruleId}**: ${f.message}`);
    if (f.fix) {
      lines.push(`  - fix: \`${f.fix.property}\` ${f.fix.from} → ${f.fix.to} (${f.fix.rationale})`);
      if (f.fix.alternative) {
        lines.push(`    - alt: ${f.fix.alternative.to} (${f.fix.alternative.rationale})`);
      }
    }
  }
  return lines.join("\n");
}
