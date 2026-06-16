import {
  analyzeElement,
  analyzePage,
  buildPacket,
  captureElement,
  capturePage,
  packetToMarkdown,
  scoreFindings,
  type ElementPacket,
  type ElementSnapshot,
  type Finding,
} from "@goldeye/engine";
import axe from "axe-core";
import { popoverHtml } from "./lib/view";
import { cropRect } from "./lib/crop";
import { axeViolationsToFindings, type AxeViolation } from "./lib/axe-findings";

// Content script: capture, run the engine in-page, show the popover, and react
// together with the side panel on one gesture.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let inspecting = false;
    let mode: "standalone" | "connected" = "standalone";
    let agent = "Claude Code";
    let hl: HTMLElement | null = null;
    let popHost: HTMLElement | null = null;
    let popBody: HTMLElement | null = null;
    let current: { el: Element; packet: ElementPacket } | null = null;

    // ---------- highlight ----------
    const ensureHl = (): HTMLElement => {
      if (!hl) {
        hl = document.createElement("div");
        hl.style.cssText =
          "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #e8b54a;border-radius:6px;box-shadow:0 0 0 1px rgba(232,181,74,.25),0 0 22px -2px rgba(232,181,74,.5);background:rgba(232,181,74,.07);transition:all .06s cubic-bezier(.4,0,.2,1);display:none;";
        document.documentElement.appendChild(hl);
      }
      return hl;
    };
    const moveHl = (el: Element): void => {
      const r = el.getBoundingClientRect();
      const h = ensureHl();
      h.style.display = "block";
      h.style.left = `${r.left - 2}px`;
      h.style.top = `${r.top - 2}px`;
      h.style.width = `${r.width}px`;
      h.style.height = `${r.height}px`;
    };
    const hideHl = (): void => {
      if (hl) hl.style.display = "none";
    };

    // ---------- popover (open shadow root, isolated from page CSS) ----------
    const POP_CSS = `
      .ge-pop { font-family: ui-sans-serif, system-ui, sans-serif; width: 300px; color: #f3f5f8;
        background: rgba(20,23,31,.94); backdrop-filter: blur(14px); border: 1px solid rgba(232,181,74,.3);
        border-radius: 14px; padding: 12px 13px; box-shadow: 0 18px 50px rgba(0,0,0,.5); font-size: 13px; }
      .ge-head { display: flex; align-items: center; gap: 8px; }
      .ge-tag { font-weight: 700; color: #f6cf6e; }
      .ge-sel { font-family: ui-monospace, monospace; font-size: 10px; color: #e8b54a;
        background: rgba(232,181,74,.12); padding: 2px 6px; border-radius: 5px; flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ge-score { font-weight: 700; }
      .ge-climb { color: #5fd0a8; }
      .ge-shot { display: block; width: 100%; max-height: 150px; object-fit: contain;
        margin: 9px 0 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.25); }
      .ge-text { color: #aab2c0; font-size: 11.5px; margin: 7px 0; }
      .ge-finding { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1);
        border-radius: 10px; padding: 9px 10px; margin: 8px 0; }
      .ge-finding b { font-size: 12px; }
      .ge-finding p { margin: 4px 0; color: #aab2c0; font-size: 11px; line-height: 1.45; }
      .ge-sev { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; }
      .ge-high { background: #ff6b6b; } .ge-medium { background: #ffb454; } .ge-low { background: #6c7689; }
      .ge-fix { font-family: ui-monospace, monospace; font-size: 10.5px; color: #5fd0a8; }
      .ge-empty { color: #6c7689; font-size: 12px; padding: 8px 2px; }
      .ge-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      .ge-act { font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; padding: 7px 11px;
        border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #aab2c0; }
      .ge-gold { background: linear-gradient(180deg, rgba(232,181,74,.95), #c8902f); color: #1a1407; border: 0; flex: 1; }`;

    const ensurePopover = (): void => {
      if (popHost) return;
      popHost = document.createElement("div");
      popHost.id = "goldeye-lens-popover";
      popHost.style.cssText = "position:fixed;z-index:2147483647;display:none;";
      const root = popHost.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = POP_CSS;
      popBody = document.createElement("div");
      popBody.className = "ge-pop";
      root.append(style, popBody);
      document.documentElement.appendChild(popHost);
    };
    const positionPopover = (el: Element): void => {
      if (!popHost) return;
      const r = el.getBoundingClientRect();
      const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 240));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 320));
      popHost.style.top = `${top}px`;
      popHost.style.left = `${left}px`;
    };
    const renderPopover = (packet: ElementPacket, prevScore?: number): void => {
      ensurePopover();
      // popoverHtml escapes every interpolated value, so this is not an injection sink.
      if (popBody)
        popBody.innerHTML = popoverHtml(packet, {
          connected: mode === "connected",
          agent,
          climbFrom: prevScore,
        });
      if (current) positionPopover(current.el);
      popBody?.querySelectorAll<HTMLElement>("[data-action]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onAction(b.dataset["action"] ?? "");
        }),
      );
      if (popHost) popHost.style.display = "block";
    };
    const hidePopover = (): void => {
      if (popHost) popHost.style.display = "none";
    };

    // ---------- a11y node + source ----------
    const IMPLICIT_ROLE: Record<string, string> = {
      button: "button", a: "link", input: "textbox", select: "combobox", textarea: "textbox",
      h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
      nav: "navigation", img: "img", ul: "list", ol: "list", li: "listitem",
    };
    const accessibleName = (el: Element): string => {
      const al = el.getAttribute("aria-label");
      if (al) return al.trim();
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const ref = document.getElementById(lb);
        if (ref?.textContent) return ref.textContent.trim().slice(0, 120);
      }
      return (el.textContent ?? "").trim().slice(0, 120);
    };
    const accessibleNode = (el: Element): { role: string; name: string } => ({
      role: el.getAttribute("role") || IMPLICIT_ROLE[el.tagName.toLowerCase()] || el.tagName.toLowerCase(),
      name: accessibleName(el),
    });
    const sourceOf = (el: Element): { file: string; line?: number } | undefined => {
      // Attribute-based: data-source, plus vite-plugin react/vue inspectors.
      const ds = el.getAttribute("data-source") || el.getAttribute("data-inspector-relative-path");
      if (ds) {
        const ln = Number(el.getAttribute("data-inspector-line"));
        return Number.isFinite(ln) && ln > 0 ? { file: ds, line: ln } : { file: ds };
      }
      // React: the fiber's _debugSource from the dev JSX transform.
      const key = Object.keys(el).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
      );
      if (key) {
        const fiber = (el as unknown as Record<string, unknown>)[key] as
          | { _debugSource?: { fileName?: string; lineNumber?: number } }
          | undefined;
        const src = fiber?._debugSource;
        if (src?.fileName) return src.lineNumber ? { file: src.fileName, line: src.lineNumber } : { file: src.fileName };
      }
      // Vue 3: the dev vnode carries its component's SFC path on __file.
      const vnode = (el as unknown as Record<string, unknown>)["__vnode"] as
        | { type?: { __file?: string } }
        | undefined;
      const vfile = vnode?.type?.__file;
      if (vfile) return { file: vfile };
      return undefined;
    };
    const snapshotOf = (el: Element): ElementSnapshot => {
      const base = captureElement(el);
      const src = sourceOf(el);
      return {
        ...base,
        a11y: accessibleNode(el),
        outerHTML: (el as HTMLElement).outerHTML.slice(0, 400),
        ...(src ? { source: src } : {}),
      };
    };

    // ---------- axe in Standalone ----------
    const axeFindings = async (context: Element | Document): Promise<Finding[]> => {
      try {
        const res = await axe.run(context as never, { resultTypes: ["violations"] });
        return axeViolationsToFindings(res.violations as unknown as AxeViolation[]);
      } catch {
        return [];
      }
    };

    // ---------- screenshot (best effort; background captures, we crop) ----------
    const cropToElement = (dataUrl: string, el: Element): Promise<string | null> =>
      new Promise((resolve) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return resolve(null);
        const img = new Image();
        img.onload = () => {
          try {
            const dpr = window.devicePixelRatio || 1;
            const { sx, sy, sw, sh } = cropRect(r, dpr, img, 6);
            const canvas = document.createElement("canvas");
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
            resolve(canvas.toDataURL("image/png"));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    const requestScreenshot = async (el: Element): Promise<void> => {
      try {
        const dataUrl = (await browser.runtime.sendMessage({ type: "capture-visible" })) as string | null;
        if (!dataUrl || current?.el !== el) return;
        const cropped = await cropToElement(dataUrl, el);
        if (cropped && current?.el === el) {
          current = { el, packet: { ...current.packet, screenshot: cropped } };
          publish(current.packet);
        }
      } catch {
        /* best effort */
      }
    };

    // ---------- selection lifecycle ----------
    const publish = (packet: ElementPacket): void => {
      void browser.runtime.sendMessage({
        type: "element-result",
        packet,
        markdown: packetToMarkdown(packet),
      });
    };
    const onInspectClick = async (el: Element): Promise<void> => {
      const snap = snapshotOf(el);
      const findings =
        mode === "standalone"
          ? [...analyzeElement(snap), ...(await axeFindings(el))]
          : analyzeElement(snap);
      const packet = buildPacket(snap, findings);
      current = { el, packet };
      renderPopover(packet);
      publish(packet);
      void requestScreenshot(el);
    };

    const onAction = (action: string): void => {
      if (!current) return;
      if (action === "copy") {
        void navigator.clipboard.writeText(packetToMarkdown(current.packet)).catch(() => {});
      } else if (action === "send") {
        void browser.runtime.sendMessage({ type: "dispatch-current" });
      } else if (action === "preview") {
        inPageReverify();
      }
    };

    // The always-on in-page proof: apply the computed fixes to the live element,
    // re-judge, and show the climb in the popover and panel. No agent needed.
    const inPageReverify = (): void => {
      if (!current) return;
      const before = current.packet.score;
      const el = current.el as HTMLElement;
      for (const fx of current.packet.fixes) el.style.setProperty(fx.property, fx.to);
      const snap = snapshotOf(el);
      const packet = buildPacket(snap, analyzeElement(snap));
      current = { el, packet };
      renderPopover(packet, before);
      publish(packet);
    };

    // ---------- pointer wiring ----------
    const onMove = (e: MouseEvent): void => {
      const el = e.target as Element | null;
      if (inspecting && el && el !== hl) moveHl(el);
    };
    const onClick = (e: MouseEvent): void => {
      if (!inspecting) return;
      e.preventDefault();
      e.stopPropagation();
      void onInspectClick(e.target as Element);
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type?: string;
        value?: boolean;
        mode?: "standalone" | "connected";
        agent?: string;
        selector?: string;
        property?: string;
        to?: string;
      };
      if (msg.type === "set-inspect") {
        inspecting = Boolean(msg.value);
        if (inspecting) {
          document.addEventListener("mousemove", onMove, true);
          document.addEventListener("click", onClick, true);
        } else {
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("click", onClick, true);
          hideHl();
          hidePopover();
        }
      } else if (msg.type === "set-mode") {
        if (msg.mode) mode = msg.mode;
        if (msg.agent) agent = msg.agent;
        if (current) renderPopover(current.packet);
      } else if (msg.type === "analyze-page") {
        void (async () => {
          const page = capturePage(document);
          const findings =
            mode === "standalone"
              ? [...analyzePage(page), ...(await axeFindings(document))]
              : analyzePage(page);
          void browser.runtime.sendMessage({
            type: "page-result",
            findings,
            score: scoreFindings(findings),
          });
        })();
      } else if (msg.type === "locate" && msg.selector) {
        const el = document.querySelector(msg.selector);
        if (el) {
          moveHl(el);
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          window.setTimeout(hideHl, 1400);
        }
      } else if (msg.type === "preview-fix" && msg.selector && msg.property && msg.to) {
        const el = document.querySelector(msg.selector) as HTMLElement | null;
        if (el) el.style.setProperty(msg.property, msg.to);
      }
    });
  },
});
