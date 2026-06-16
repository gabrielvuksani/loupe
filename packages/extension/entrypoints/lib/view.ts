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

// The popover's inner HTML for a selected element. Option B: element-led. The
// header says what the element is and its accessible name; the score is a small
// muted pill; the primary action is the full-width anchor; findings collapse
// behind a disclosure. Every interpolated value is escaped; the host page never
// injects markup.
export function popoverHtml(packet: ElementPacket, opts: PopoverOpts): string {
  // Lead with the element: tag, its role when that adds information, and the
  // accessible name a human reads, so identity comes before judgement.
  const role = packet.a11y?.role;
  const name = packet.a11y?.name;
  const ident =
    `<span class="lp-tag">${escapeHtml(packet.tag)}</span>` +
    (role && role !== packet.tag ? `<span class="lp-role">${escapeHtml(role)}</span>` : "") +
    (name ? `<span class="lp-name">${escapeHtml(name)}</span>` : "");
  // The score is demoted to a muted pill; the green climb pill on a re-verify is
  // the one moment it earns emphasis, since the climb is the loop's payoff.
  const score =
    typeof opts.climbFrom === "number" && opts.climbFrom !== packet.score
      ? `<span class="lp-score lp-climb">${opts.climbFrom} &rarr; ${packet.score}/100</span>`
      : `<span class="lp-score">${packet.score}/100</span>`;

  // Size, on-screen position, and the unambiguous target path: the locating
  // signals the packet carries, surfaced so a weak model can act.
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

  const text = packet.text ? `<div class="lp-text">"${escapeHtml(packet.text)}"</div>` : "";
  const shot = screenshotImg(packet.screenshot);

  // The primary action is the full-width anchor: dispatch when connected, copy
  // the packet when standalone. Copy stays as a secondary in connected, and
  // Preview only when there is a computed fix to apply on the page.
  const primary = opts.connected
    ? `<button class="lp-act lp-gold" data-action="send">Send to ${escapeHtml(opts.agent)}</button>`
    : `<button class="lp-act lp-gold" data-action="copy">Copy</button>`;
  const copySecondary = opts.connected ? `<button class="lp-act" data-action="copy">Copy</button>` : "";
  const preview = packet.fixes.length
    ? `<button class="lp-act" data-action="preview">Preview fix</button>`
    : "";
  const sub = copySecondary || preview ? `<div class="lp-subact">${copySecondary}${preview}</div>` : "";

  // Findings collapse behind a disclosure, default collapsed: the popover is the
  // quick change surface; the side panel carries the full findings detail.
  const n = packet.findings.length;
  const findings = n
    ? `<details class="lp-findings"><summary>${n} finding${n === 1 ? "" : "s"}</summary>${packet.findings
        .map(findingRow)
        .join("")}</details>`
    : `<div class="lp-empty">Passes loupe's checks. Still dispatchable.</div>`;

  return `<div class="lp-head">${ident}${score}</div>
    <div class="lp-selrow"><span class="lp-sel">${escapeHtml(packet.selector)}</span></div>
    ${meta}
    ${shot}
    ${text}
    <div class="lp-actions">${primary}${sub}</div>
    ${findings}`;
}
