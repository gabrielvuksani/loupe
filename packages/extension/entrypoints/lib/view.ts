import type { ElementPacket, Finding } from "@goldeye/engine";

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function findingRow(f: Finding): string {
  const fix = f.fix
    ? `<div class="ge-fix">${escapeHtml(f.fix.property)}: ${escapeHtml(f.fix.from)} &rarr; ${escapeHtml(f.fix.to)}</div>`
    : "";
  return `<div class="ge-finding"><span class="ge-sev ge-${escapeHtml(f.severity)}"></span><b>${escapeHtml(
    f.ruleId,
  )}</b><p>${escapeHtml(f.message)}</p>${fix}</div>`;
}

export interface PopoverOpts {
  connected: boolean;
  agent: string;
  climbFrom?: number;
}

// Only render a same-origin data-image URL. The prefix check rejects javascript:
// and other schemes before they reach src; escapeHtml stays for consistency.
export function screenshotImg(screenshot: string | undefined): string {
  if (!screenshot || !screenshot.startsWith("data:image/")) return "";
  return `<img class="ge-shot" alt="" src="${escapeHtml(screenshot)}" />`;
}

// The popover's inner HTML for a selected element: verdict, findings, actions.
// Every interpolated value is escaped; the host page never injects markup.
export function popoverHtml(packet: ElementPacket, opts: PopoverOpts): string {
  const findings = packet.findings.length
    ? packet.findings.map(findingRow).join("")
    : `<div class="ge-empty">Passes goldeye's deterministic checks. Still dispatchable.</div>`;
  const send = opts.connected
    ? `<button class="ge-act ge-gold" data-action="send">Send to ${escapeHtml(opts.agent)}</button>`
    : "";
  const text = packet.text ? `<div class="ge-text">"${escapeHtml(packet.text)}"</div>` : "";
  const shot = screenshotImg(packet.screenshot);
  // After a re-verify, show the before to after climb: the loop's payoff.
  const score =
    typeof opts.climbFrom === "number" && opts.climbFrom !== packet.score
      ? `<span class="ge-score ge-climb">${opts.climbFrom} &rarr; ${packet.score}/100</span>`
      : `<span class="ge-score">${packet.score}/100</span>`;
  return `<div class="ge-head">
      <span class="ge-tag">${escapeHtml(packet.tag)}</span>
      <span class="ge-sel">${escapeHtml(packet.selector)}</span>
      ${score}
    </div>
    ${shot}
    ${text}
    <div class="ge-findings">${findings}</div>
    <div class="ge-actions">${send}
      <button class="ge-act" data-action="copy">Copy</button>
      <button class="ge-act" data-action="preview">Preview</button>
    </div>`;
}
