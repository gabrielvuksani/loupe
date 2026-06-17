import { findingsToMarkdown } from "@loupe/engine";
import type { ElementPacket, Finding, Score } from "@loupe/engine";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

type Mode = "standalone" | "connected";
let mode: Mode = "standalone";
let agent = "Claude Code";
let inspecting = false;
let ws: WebSocket | null = null;
let wsReconnect: ReturnType<typeof setTimeout> | null = null;
let lastPacket: { packet: ElementPacket; markdown: string } | null = null;
let lastSelectorScore: { selector: string; score: number } | null = null;
let lastPageScore: number | null = null;
let lastAudit: { findings: Finding[]; score: Score } | null = null;

async function activeTabId(): Promise<number | undefined> {
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  return t?.id;
}
async function activeTabUrl(): Promise<string | undefined> {
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  return t?.url;
}
async function toTab(msg: unknown): Promise<void> {
  const id = await activeTabId();
  if (id == null) return;
  try {
    await browser.tabs.sendMessage(id, msg);
  } catch {
    // No content script in this tab yet: it was open before Loupe loaded, or it
    // is a page Loupe cannot touch. Inject the content script, then retry once.
    try {
      await browser.scripting.executeScript({
        target: { tabId: id },
        files: ["/content-scripts/content.js"],
      });
      await browser.tabs.sendMessage(id, msg);
    } catch {
      toast("Loupe can't reach this tab. Open a normal website (not a chrome:// or extensions page) and try again.");
    }
  }
}

function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 2200);
}

// Live agent log: the dispatched agent's output, streamed in as it works.
// textContent (never innerHTML) keeps streamed stdout as inert text.
function showLog(headline: string): void {
  const el = $("agentlog");
  el.style.display = "block";
  el.textContent = headline + "\n";
}
function appendLog(text: string): void {
  const el = $("agentlog");
  el.style.display = "block";
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

// Persistent engine status in the header: green connected, red offline, hidden
// in Standalone where there is no engine to reach.
function setConn(state: "on" | "off" | null): void {
  const el = $("conn");
  el.style.display = state ? "inline-block" : "none";
  el.classList.toggle("on", state === "on");
  el.classList.toggle("off", state === "off");
  el.textContent = state === "on" ? "connected" : "offline";
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function projectRoot(): string {
  return ($("root") as HTMLInputElement).value.trim();
}
function pushMode(): void {
  void toTab({ type: "set-mode", mode, agent });
}

// Persist the Connected-mode inputs so they survive reopening the panel.
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`loupe.${key}`, value);
  } catch {
    /* storage unavailable (private mode); not worth surfacing */
  }
}
function recall(key: string): string {
  try {
    return localStorage.getItem(`loupe.${key}`) ?? "";
  } catch {
    return "";
  }
}

// ---------- mode + agent ----------
function setMode(m: Mode): void {
  mode = m;
  document.querySelectorAll("#mode .pill").forEach((b) =>
    b.classList.toggle("on", (b as HTMLElement).dataset["mode"] === m),
  );
  $("modeNote").innerHTML =
    m === "connected"
      ? `<b>Full loop.</b> Element packets stream to the loupe engine and your CLI agent (${escapeHtml(agent)}) to apply, then re-verify.`
      : `<b>Local engine.</b> Deterministic checks run in your browser: contrast, target size, type scale, palette. $0, offline, nothing leaves the tab.`;
  const showRoot = m === "connected";
  // The agent picker only matters in Connected mode; Standalone copies to the
  // clipboard and never spawns an agent, so it hides with the dispatch fields.
  $("agentLabel").style.display = showRoot ? "block" : "none";
  $("agent").style.display = showRoot ? "grid" : "none";
  $("rootLabel").style.display = showRoot ? "block" : "none";
  $("root").style.display = showRoot ? "block" : "none";
  $("token").style.display = showRoot ? "block" : "none";
  $("request").style.display = showRoot ? "block" : "none";
  $("requestLabel").style.display = showRoot ? "block" : "none";
  setConn(showRoot ? "off" : null);
  // a mode switch changes what the audit measures, so reset the climb baselines
  lastPageScore = null;
  lastSelectorScore = null;
  pushMode();
  if (m === "connected") connectWs();
  else {
    if (wsReconnect) {
      clearTimeout(wsReconnect);
      wsReconnect = null;
    }
    ws?.close();
    ws = null;
  }
}
function connectWs(): void {
  if (wsReconnect) {
    clearTimeout(wsReconnect);
    wsReconnect = null;
  }
  try {
    const token = ($("token") as HTMLInputElement).value.trim();
    const url = token
      ? `ws://127.0.0.1:8791/?token=${encodeURIComponent(token)}`
      : "ws://127.0.0.1:8791";
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      setConn("on");
      toast("Engine connected");
    });
    ws.addEventListener("error", () => {
      setConn("off");
      toast("Engine offline. Run: loupe serve");
    });
    ws.addEventListener("close", () => {
      setConn("off");
      // Reconnect while still in Connected mode, e.g. after the daemon restarts.
      if (mode === "connected" && !wsReconnect) {
        wsReconnect = setTimeout(() => {
          wsReconnect = null;
          connectWs();
        }, 3000);
      }
    });
    ws.addEventListener("message", (e) => {
      try {
        const m = JSON.parse(String(e.data)) as {
          type?: string;
          phase?: string;
          message?: string;
          chunk?: string;
          diff?: string;
        };
        if (m.type === "dispatch-status") {
          if (m.phase === "dispatching") {
            showLog(`▷ ${agent} working…`);
            toast(`Dispatching to ${agent}...`);
          } else if (m.phase === "output" && m.chunk) {
            appendLog(m.chunk);
          } else if (m.phase === "applied") {
            appendLog("\n✓ applied. Re-verify to see the climb.\n");
            toast("Agent applied. Re-verify to see the climb");
          } else if (m.phase === "diff" && m.diff) {
            appendLog(`\nChanged files:\n${m.diff}\n`);
          } else if (m.phase === "error") {
            appendLog(`\n✕ ${m.message ?? "dispatch failed"}\n`);
            toast(m.message ?? "Dispatch failed");
          }
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}
// The CLI loupe spawns for each agent label, surfaced so picking one in
// Connected mode says what will actually run instead of sitting there unexplained.
const AGENT_CMD: Record<string, string> = {
  "Claude Code": "claude",
  Codex: "codex",
  OpenCode: "opencode",
};
function setAgent(name: string): void {
  agent = name;
  remember("agent", name);
  document.querySelectorAll("#agent .pill").forEach((b) =>
    b.classList.toggle("on", (b as HTMLElement).dataset["agent"] === name),
  );
  pushMode();
  if (mode === "connected") {
    setMode("connected");
    toast(`loupe will run ${AGENT_CMD[name] ?? name} in your project root`);
  }
}

// ---------- render ----------
function findingHtml(f: Finding): string {
  const fix = f.fix ? `<p class="fix">fix · ${escapeHtml(f.fix.property)}: ${escapeHtml(f.fix.from)} → ${escapeHtml(f.fix.to)}</p>` : "";
  const preview = f.fix
    ? `<button class="act" data-preview='${escapeHtml(JSON.stringify({ selector: f.selector, property: f.fix.property, to: f.fix.to }))}'>Preview fix</button>`
    : "";
  return `<div class="finding">
    <div class="top"><span class="sev ${f.severity}"></span><span class="t">${escapeHtml(f.ruleId)}</span><span class="sel">${escapeHtml(f.selector)}</span></div>
    <p class="desc">${escapeHtml(f.message)}</p>${fix}
    <div class="row"><button class="act" data-locate="${escapeHtml(f.selector)}">Locate</button>${preview}</div>
  </div>`;
}

// The score, demoted to a small muted pill to match the in-page popover. The
// green climb pill on a re-verify is the one time it earns emphasis.
function scorePill(score: number, prev: number | null): string {
  return prev !== null
    ? `<span class="spill climb">${prev} → ${score}/100</span>`
    : `<span class="spill">${score}/100</span>`;
}

function renderAudit(findings: Finding[], score: Score): void {
  lastAudit = { findings, score };
  // Re-scanning the same page with a different score is the re-verify climb.
  const prev = lastPageScore !== null && lastPageScore !== score.overall ? lastPageScore : null;
  lastPageScore = score.overall;
  $("scoreHost").innerHTML = `<div class="ecard">
    <div class="etop"><span class="etag">Page health</span>${scorePill(score.overall, prev)}</div>
    <div class="esub">${findings.length} finding(s) · taste ${score.byCategory.taste} · a11y ${score.byCategory.a11y}</div>
  </div>`;
  const primary = findings.length
    ? `<button class="act gold full" id="fixall">${
        mode === "connected" ? "Fix all " + findings.length + " with " + escapeHtml(agent) : "Copy all findings"
      }</button>`
    : "";
  $("findings").innerHTML =
    (primary ? `<div class="pact">${primary}</div>` : "") +
    (findings.length
      ? findings.map(findingHtml).join("")
      : `<div class="empty">No findings. The page passes loupe's deterministic checks.</div>`);
  wireFindingActions();
  document.getElementById("fixall")?.addEventListener("click", () => void doBatchDispatch());
}

function renderPacket(packet: ElementPacket, markdown: string): void {
  lastPacket = { packet, markdown };
  // Same element re-judged with a different score is the re-verify climb.
  const prev =
    lastSelectorScore &&
    lastSelectorScore.selector === packet.selector &&
    lastSelectorScore.score !== packet.score
      ? lastSelectorScore.score
      : null;
  lastSelectorScore = { selector: packet.selector, score: packet.score };
  // Element-led header to match the popover: what it is and its accessible name,
  // the score a muted pill, the selector on its own line.
  const role = packet.a11y?.role;
  const name = packet.a11y?.name;
  const ident =
    `<span class="etag">${escapeHtml(packet.tag)}</span>` +
    (role && role !== packet.tag ? `<span class="erole">${escapeHtml(role)}</span>` : "") +
    (name ? `<span class="ename">${escapeHtml(name)}</span>` : "");
  $("scoreHost").innerHTML = `<div class="ecard">
    <div class="etop">${ident}${scorePill(packet.score, prev)}</div>
    <div class="esel">${escapeHtml(packet.selector)}</div>
  </div>`;
  const primary = `<button class="act gold full" id="dispatch">${
    mode === "connected" ? "Send to " + escapeHtml(agent) : "Copy element packet"
  }</button>`;
  $("findings").innerHTML =
    `<div class="pact">${primary}</div>` +
    (packet.findings.length
      ? packet.findings.map(findingHtml).join("")
      : `<div class="empty">This element passes loupe's checks. Still dispatchable.</div>`);
  wireFindingActions();
  document.getElementById("dispatch")?.addEventListener("click", doDispatch);
}

function doDispatch(): void {
  if (!lastPacket) return;
  if (mode === "connected") {
    const cwd = projectRoot();
    if (!cwd) {
      toast("Set the project root first");
      return;
    }
    if (ws?.readyState === WebSocket.OPEN) {
      const request = ($("request") as HTMLTextAreaElement).value.trim();
      ws.send(JSON.stringify({ type: "dispatch", agent, packet: lastPacket.packet, cwd, request }));
      toast(request ? `Sent to ${agent} with your request` : `Dispatched to ${agent}`);
    } else {
      toast("Engine offline. Run: loupe serve");
    }
  } else {
    void navigator.clipboard
      .writeText(lastPacket.markdown)
      .then(() => toast("Packet copied. Paste into your agent"))
      .catch(() => toast("Copy failed"));
  }
}

async function doBatchDispatch(): Promise<void> {
  if (!lastAudit || !lastAudit.findings.length) return;
  if (mode === "connected") {
    const cwd = projectRoot();
    if (!cwd) {
      toast("Set the project root first");
      return;
    }
    if (ws?.readyState === WebSocket.OPEN) {
      const request = ($("request") as HTMLTextAreaElement).value.trim();
      const url = await activeTabUrl();
      ws.send(
        JSON.stringify({
          type: "dispatch-batch",
          agent,
          findings: lastAudit.findings,
          cwd,
          request,
          url,
          score: lastAudit.score.overall,
        }),
      );
      toast(
        request
          ? `Fixing all with ${agent} and your request`
          : `Fixing all ${lastAudit.findings.length} with ${agent}`,
      );
    } else {
      toast("Engine offline. Run: loupe serve");
    }
  } else {
    void navigator.clipboard
      .writeText(findingsToMarkdown(lastAudit.findings, { score: lastAudit.score.overall }))
      .then(() => toast("All findings copied. Paste into your agent"))
      .catch(() => toast("Copy failed"));
  }
}

function wireFindingActions(): void {
  document.querySelectorAll("[data-locate]").forEach((b) =>
    b.addEventListener("click", () => void toTab({ type: "locate", selector: (b as HTMLElement).dataset["locate"] })),
  );
  document.querySelectorAll("[data-preview]").forEach((b) =>
    b.addEventListener("click", () => {
      try {
        const p = JSON.parse((b as HTMLElement).dataset["preview"] as string);
        void toTab({ type: "preview-fix", ...p });
        toast("Fix previewed on the page");
      } catch {
        /* ignore */
      }
    }),
  );
}

// ---------- wiring ----------
$("inspect").addEventListener("click", () => {
  inspecting = !inspecting;
  $("inspect").classList.toggle("on", inspecting);
  $("inspect").textContent = inspecting ? "Stop inspecting" : "Inspect element";
  void toTab({ type: "set-inspect", value: inspecting });
});
$("scan").addEventListener("click", () => void toTab({ type: "analyze-page" }));
// Color-vision simulation: a pure client-side overlay, works in either mode.
$("vision").addEventListener("change", () => {
  const cvd = ($("vision") as HTMLSelectElement).value;
  void toTab({ type: "set-vision", cvd: cvd || null });
  toast(cvd ? `Simulating ${cvd}` : "Vision simulation off");
});
document.querySelectorAll("#mode .pill").forEach((b) =>
  b.addEventListener("click", () => setMode((b as HTMLElement).dataset["mode"] as Mode)),
);
document.querySelectorAll("#agent .pill").forEach((b) =>
  b.addEventListener("click", () => setAgent((b as HTMLElement).dataset["agent"] as string)),
);
// Keep the store's request current so a live, pulling agent sees the latest ask.
$("request").addEventListener("change", () => {
  if (mode === "connected" && ws?.readyState === WebSocket.OPEN && lastPacket) {
    const request = ($("request") as HTMLTextAreaElement).value.trim();
    ws.send(JSON.stringify({ type: "publish-selection", packet: lastPacket.packet, request }));
  }
});

// Remember the Connected inputs across panel reopens, and restore them on load.
$("root").addEventListener("change", () => remember("root", projectRoot()));
$("token").addEventListener("change", () =>
  remember("token", ($("token") as HTMLInputElement).value.trim()),
);
const savedRoot = recall("root");
if (savedRoot) ($("root") as HTMLInputElement).value = savedRoot;
const savedToken = recall("token");
if (savedToken) ($("token") as HTMLInputElement).value = savedToken;
const savedAgent = recall("agent");
if (savedAgent) {
  agent = savedAgent;
  document.querySelectorAll("#agent .pill").forEach((b) =>
    b.classList.toggle("on", (b as HTMLElement).dataset["agent"] === savedAgent),
  );
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type?: string;
    packet?: ElementPacket;
    markdown?: string;
    findings?: Finding[];
    score?: Score;
  };
  if (msg.type === "element-result" && msg.packet && msg.markdown) {
    renderPacket(msg.packet, msg.markdown);
    if (mode === "connected" && ws?.readyState === WebSocket.OPEN) {
      const request = ($("request") as HTMLTextAreaElement).value.trim();
      ws.send(JSON.stringify({ type: "publish-selection", packet: msg.packet, request }));
    }
  } else if (msg.type === "page-result" && msg.findings && msg.score) {
    renderAudit(msg.findings, msg.score);
  } else if (msg.type === "dispatch-current") {
    doDispatch();
  } else if (msg.type === "inspect-stopped") {
    // The page stopped inspecting (Escape or hotkey); resync the Inspect toggle.
    inspecting = false;
    $("inspect").classList.remove("on");
    $("inspect").textContent = "Inspect element";
  } else if (msg.type === "inspect-started") {
    // The page started inspecting (hotkey); resync the Inspect toggle.
    inspecting = true;
    $("inspect").classList.add("on");
    $("inspect").textContent = "Stop inspecting";
  }
});
