import type { ElementPacket, Finding, Score } from "@goldeye/engine";

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

type Mode = "standalone" | "connected";
let mode: Mode = "standalone";
let agent = "Claude Code";
let inspecting = false;
let ws: WebSocket | null = null;
let lastPacket: { packet: ElementPacket; markdown: string } | null = null;

async function activeTabId(): Promise<number | undefined> {
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  return t?.id;
}
async function toTab(msg: unknown): Promise<void> {
  const id = await activeTabId();
  if (id != null) {
    try {
      await browser.tabs.sendMessage(id, msg);
    } catch {
      /* no content script on this page (e.g. chrome://) */
    }
  }
}

function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 2200);
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

// ---------- mode + agent ----------
function setMode(m: Mode): void {
  mode = m;
  document.querySelectorAll("#mode .pill").forEach((b) =>
    b.classList.toggle("on", (b as HTMLElement).dataset["mode"] === m),
  );
  $("modeNote").innerHTML =
    m === "connected"
      ? `<b>Full loop.</b> Element packets stream to the goldeye engine and your CLI agent (${escapeHtml(agent)}) to apply, then re-verify.`
      : `<b>Local engine.</b> Deterministic checks run in your browser: contrast, target size, type scale, palette. $0, offline, nothing leaves the tab.`;
  const showRoot = m === "connected";
  $("rootLabel").style.display = showRoot ? "block" : "none";
  $("root").style.display = showRoot ? "block" : "none";
  $("token").style.display = showRoot ? "block" : "none";
  pushMode();
  if (m === "connected") connectWs();
  else {
    ws?.close();
    ws = null;
  }
}
function connectWs(): void {
  try {
    const token = ($("token") as HTMLInputElement).value.trim();
    const url = token
      ? `ws://127.0.0.1:8791/?token=${encodeURIComponent(token)}`
      : "ws://127.0.0.1:8791";
    ws = new WebSocket(url);
    ws.addEventListener("open", () => toast("Engine connected"));
    ws.addEventListener("error", () =>
      toast("Engine offline. Start: pnpm --filter @goldeye/connected serve"),
    );
    ws.addEventListener("message", (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { type?: string; phase?: string; message?: string };
        if (m.type === "dispatch-status") {
          if (m.phase === "dispatching") toast(`Dispatching to ${agent}...`);
          else if (m.phase === "applied") toast("Agent applied. Re-verify to see the climb");
          else if (m.phase === "error") toast(m.message ?? "Dispatch failed");
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}
function setAgent(name: string): void {
  agent = name;
  document.querySelectorAll("#agent .pill").forEach((b) =>
    b.classList.toggle("on", (b as HTMLElement).dataset["agent"] === name),
  );
  pushMode();
  if (mode === "connected") setMode("connected");
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

function scoreCard(p: number, label: string, detail: string): string {
  return `<div class="score">
    <div class="ring" style="--p:${p}"><span>${p}</span></div>
    <div class="meta"><div class="l">${escapeHtml(label)}</div><div class="d">${escapeHtml(detail)}</div></div>
  </div>`;
}

function renderAudit(findings: Finding[], score: Score): void {
  $("scoreHost").innerHTML = scoreCard(
    score.overall,
    "Page health",
    `${findings.length} finding(s) · taste ${score.byCategory.taste} · a11y ${score.byCategory.a11y}`,
  );
  $("findings").innerHTML = findings.length
    ? findings.map(findingHtml).join("")
    : `<div class="empty">No findings. The page passes goldeye's deterministic checks.</div>`;
  wireFindingActions();
}

function renderPacket(packet: ElementPacket, markdown: string): void {
  lastPacket = { packet, markdown };
  $("scoreHost").innerHTML = scoreCard(
    packet.score,
    `${packet.tag} · ${packet.selector}`,
    `${packet.findings.length} finding(s)`,
  );
  const dispatchBtn = `<div class="finding"><div class="row">
    <button class="act gold" id="dispatch" style="flex:1">${mode === "connected" ? "Send to " + escapeHtml(agent) : "Copy element packet"}</button>
  </div></div>`;
  $("findings").innerHTML =
    (packet.findings.length
      ? packet.findings.map(findingHtml).join("")
      : `<div class="empty">This element passes, still dispatchable.</div>`) + dispatchBtn;
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
      ws.send(JSON.stringify({ type: "dispatch", agent, packet: lastPacket.packet, cwd }));
      toast(`Dispatched to ${agent}`);
    } else {
      toast("Engine offline. Start: pnpm --filter @goldeye/connected serve");
    }
  } else {
    void navigator.clipboard
      .writeText(lastPacket.markdown)
      .then(() => toast("Packet copied. Paste into your agent"))
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
document.querySelectorAll("#mode .pill").forEach((b) =>
  b.addEventListener("click", () => setMode((b as HTMLElement).dataset["mode"] as Mode)),
);
document.querySelectorAll("#agent .pill").forEach((b) =>
  b.addEventListener("click", () => setAgent((b as HTMLElement).dataset["agent"] as string)),
);

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
      ws.send(JSON.stringify({ type: "publish-selection", packet: msg.packet }));
    }
  } else if (msg.type === "page-result" && msg.findings && msg.score) {
    renderAudit(msg.findings, msg.score);
  } else if (msg.type === "dispatch-current") {
    doDispatch();
  }
});
