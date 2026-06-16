import type { ElementPacket, Finding } from "@loupe/engine";

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function findingRow(f: Finding): string {
  const fix = f.fix
    ? `<div class="lp-fix">${escapeHtml(f.fix.property)}: ${escapeHtml(f.fix.from)} &rarr; ${escapeHtml(f.fix.to)}</div>`
    : "";
  return `<div class="lp-finding"><span class="lp-sev lp-${escapeHtml(f.severity)}"></span><b>${escapeHtml(
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
  return `<img class="lp-shot" alt="" src="${escapeHtml(screenshot)}" />`;
}

// The popover's inner HTML for a selected element: verdict, findings, actions.
// Every interpolated value is escaped; the host page never injects markup.
export function popoverHtml(packet: ElementPacket, opts: PopoverOpts): string {
  const findings = packet.findings.length
    ? packet.findings.map(findingRow).join("")
    : `<div class="lp-empty">Passes loupe's deterministic checks. Still dispatchable.</div>`;
  const send = opts.connected
    ? `<button class="lp-act lp-gold" data-action="send">Send to ${escapeHtml(opts.agent)}</button>`
    : "";
  const text = packet.text ? `<div class="lp-text">"${escapeHtml(packet.text)}"</div>` : "";
  const shot = screenshotImg(packet.screenshot);
  // Size, on-screen position, and the unambiguous target path: the same locating
  // signals the packet carries, surfaced on the page so a weak model can act.
  const pos = packet.box
    ? `${Math.round(packet.box.width)}x${Math.round(packet.box.height)}px` +
      (packet.box.x !== undefined && packet.box.y !== undefined
        ? ` at (${Math.round(packet.box.x)}, ${Math.round(packet.box.y)})`
        : "")
    : "";
  const target =
    packet.uniqueSelector && packet.uniqueSelector !== packet.selector ? packet.uniqueSelector : "";
  const meta =
    pos || target
      ? `<div class="lp-meta">${pos ? `<span>${escapeHtml(pos)}</span>` : ""}${
          target ? `<span class="lp-utarget">${escapeHtml(target)}</span>` : ""
        }</div>`
      : "";
  // After a re-verify, show the before to after climb: the loop's payoff.
  const score =
    typeof opts.climbFrom === "number" && opts.climbFrom !== packet.score
      ? `<span class="lp-score lp-climb">${opts.climbFrom} &rarr; ${packet.score}/100</span>`
      : `<span class="lp-score">${packet.score}/100</span>`;
  return `<div class="lp-head">
      <span class="lp-tag">${escapeHtml(packet.tag)}</span>
      <span class="lp-sel">${escapeHtml(packet.selector)}</span>
      ${score}
    </div>
    ${meta}
    ${shot}
    ${text}
    <div class="lp-findings">${findings}</div>
    <div class="lp-actions">${send}
      <button class="lp-act" data-action="copy">Copy</button>
      <button class="lp-act" data-action="preview">Preview</button>
    </div>`;
}
