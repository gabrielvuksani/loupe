import {
  analyzeElement,
  analyzePage,
  buildPacket,
  captureElement,
  capturePage,
  packetToMarkdown,
  scoreFindings,
  svgColorMatrix,
  CVD_MATRICES,
  type CvdType,
  type ElementPacket,
  type ElementSnapshot,
  type Finding,
} from "@loupe/engine";
import { popoverHtml } from "./lib/view";
import { placePopover } from "./lib/position";
import { nearestGaps, betweenGaps } from "./lib/measure";
import { focusOrder } from "./lib/focus-order";
import { buildOutline } from "./lib/outline";
import { cropRect } from "./lib/crop";
import { axeViolationsToFindings, type AxeViolation } from "./lib/axe-findings";

// Content script: capture, run the engine in-page, show the popover, and react
// together with the side panel on one gesture.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // A tab can get the content script twice: from the manifest match and from
    // an on-demand panel injection. Run setup only once per tab.
    const loaded = window as unknown as { __loupeLoaded?: boolean };
    if (loaded.__loupeLoaded) return;
    loaded.__loupeLoaded = true;

    let inspecting = false;
    let mode: "standalone" | "connected" = "standalone";
    let agent = "Claude Code";
    let hl: HTMLElement | null = null;
    let guides: HTMLElement | null = null;
    let guideEl: Element | null = null;
    let popHost: HTMLElement | null = null;
    let popBody: HTMLElement | null = null;
    let current: { el: Element; packet: ElementPacket } | null = null;

    // ---------- highlight ----------
    const ensureHl = (): HTMLElement => {
      if (!hl) {
        hl = document.createElement("div");
        // No position transition: left/top/width/height are rewritten on every
        // mousemove, so a transition makes the highlight trail the cursor.
        hl.style.cssText =
          "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #e8b54a;border-radius:6px;box-shadow:0 0 0 1px rgba(232,181,74,.25),0 0 22px -2px rgba(232,181,74,.5);background:rgba(232,181,74,.07);display:none;";
        // A VisBug-style size badge: read an element's dimensions on hover, before
        // selecting it. It rides inside the (pointer-events:none) highlight host.
        const badge = document.createElement("div");
        badge.style.cssText =
          "position:absolute;left:-2px;font:600 10px/1 ui-monospace,monospace;color:#1a1407;background:#e8b54a;padding:2px 5px;border-radius:4px;white-space:nowrap;";
        hl.appendChild(badge);
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
      const badge = h.firstElementChild as HTMLElement | null;
      if (badge) {
        badge.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
        // Sit above the box, or tuck inside when the element hugs the viewport top.
        badge.style.top = r.top < 22 ? "2px" : "-19px";
      }
    };
    const hideHl = (): void => {
      if (hl) hl.style.display = "none";
    };

    // ---------- spacing guides (VisBug-style distance to neighbors) ----------
    const ensureGuides = (): HTMLElement => {
      if (!guides) {
        guides = document.createElement("div");
        guides.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;display:none;";
        document.documentElement.appendChild(guides);
      }
      return guides;
    };
    const clearGuides = (): void => {
      if (guides) {
        guides.replaceChildren();
        guides.style.display = "none";
      }
      guideEl = null;
    };
    // One mint dashed line spanning a gap, with a px badge at its midpoint.
    const addGuide = (host: HTMLElement, x: number, y: number, len: number, horizontal: boolean, label: string): void => {
      const col = "#5fd0a8";
      const line = document.createElement("div");
      line.style.cssText = horizontal
        ? `position:absolute;left:${x}px;top:${y}px;width:${len}px;height:0;border-top:1px dashed ${col};`
        : `position:absolute;left:${x}px;top:${y}px;width:0;height:${len}px;border-left:1px dashed ${col};`;
      const tag = document.createElement("div");
      tag.textContent = label;
      tag.style.cssText =
        `position:absolute;left:${horizontal ? x + len / 2 : x}px;top:${horizontal ? y : y + len / 2}px;` +
        `transform:translate(-50%,-50%);font:600 9px/1 ui-monospace,monospace;color:#06281f;background:${col};` +
        `padding:1px 4px;border-radius:3px;white-space:nowrap;`;
      host.append(line, tag);
    };
    const drawGuides = (el: Element): void => {
      const host = ensureGuides();
      host.replaceChildren();
      const t = el.getBoundingClientRect();
      const kids = el.parentElement ? Array.from(el.parentElement.children) : [];
      const rects = kids
        .filter((c) => c !== el && !isOwnUi(c))
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ top: r.top, right: r.right, bottom: r.bottom, left: r.left }));
      const gaps = nearestGaps({ top: t.top, right: t.right, bottom: t.bottom, left: t.left }, rects);
      const cx = (t.left + t.right) / 2;
      const cy = (t.top + t.bottom) / 2;
      if (gaps.right !== undefined) addGuide(host, t.right, cy, gaps.right, true, `${Math.round(gaps.right)}`);
      if (gaps.left !== undefined) addGuide(host, t.left - gaps.left, cy, gaps.left, true, `${Math.round(gaps.left)}`);
      if (gaps.bottom !== undefined) addGuide(host, cx, t.bottom, gaps.bottom, false, `${Math.round(gaps.bottom)}`);
      if (gaps.top !== undefined) addGuide(host, cx, t.top - gaps.top, gaps.top, false, `${Math.round(gaps.top)}`);
      host.style.display = "block";
    };
    // VisBug's two-element measure: with one element selected, holding Shift and
    // hovering a second element shows the edge-to-edge distance between the two.
    const drawBetween = (aEl: Element, bEl: Element): void => {
      const host = ensureGuides();
      host.replaceChildren();
      const a = aEl.getBoundingClientRect();
      const b = bEl.getBoundingClientRect();
      // A dashed outline on the second element so the measured pair is unambiguous.
      const mark = document.createElement("div");
      mark.style.cssText = `position:fixed;left:${b.left - 1}px;top:${b.top - 1}px;width:${b.width}px;height:${b.height}px;border:1px dashed #5fd0a8;box-sizing:border-box;`;
      host.appendChild(mark);
      const gaps = betweenGaps(
        { top: a.top, right: a.right, bottom: a.bottom, left: a.left },
        { top: b.top, right: b.right, bottom: b.bottom, left: b.left },
      );
      const acx = (a.left + a.right) / 2;
      const acy = (a.top + a.bottom) / 2;
      if (gaps.dx !== undefined) addGuide(host, a.right <= b.left ? a.right : b.right, acy, gaps.dx, true, `${Math.round(gaps.dx)}`);
      if (gaps.dy !== undefined) addGuide(host, acx, a.bottom <= b.top ? a.bottom : b.bottom, gaps.dy, false, `${Math.round(gaps.dy)}`);
      host.style.display = "block";
    };

    // ---------- overflow highlight (which elements push past the viewport) ----------
    let overflowHost: HTMLElement | null = null;
    let overflowTimer: number | null = null;
    const showOverflow = (): number => {
      if (!overflowHost) {
        overflowHost = document.createElement("div");
        overflowHost.style.cssText = "position:fixed;inset:0;z-index:2147483644;pointer-events:none;";
        document.documentElement.appendChild(overflowHost);
      }
      overflowHost.replaceChildren();
      if (overflowTimer) window.clearTimeout(overflowTimer);
      const vw = document.documentElement.clientWidth;
      let count = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        if (isOwnUi(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > vw + 1) {
          count++;
          if (count <= 80) {
            const mark = document.createElement("div");
            mark.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:1.5px solid #ff6b6b;background:rgba(255,107,107,.07);box-sizing:border-box;`;
            overflowHost.appendChild(mark);
          }
        }
      }
      overflowHost.style.display = "block";
      // Auto-clear so the page is not left marked up indefinitely.
      overflowTimer = window.setTimeout(() => overflowHost?.replaceChildren(), 6000);
      return count;
    };

    // ---------- focus-order overlay (numbered tab sequence) ----------
    let focusHost: HTMLElement | null = null;
    let focusShown = false;
    const FOCUSABLE =
      "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]";
    const toggleFocusOrder = (): boolean => {
      if (!focusHost) {
        focusHost = document.createElement("div");
        focusHost.style.cssText = "position:fixed;inset:0;z-index:2147483644;pointer-events:none;";
        document.documentElement.appendChild(focusHost);
      }
      focusShown = !focusShown;
      focusHost.replaceChildren();
      focusHost.style.display = focusShown ? "block" : "none";
      if (!focusShown) return false;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !isOwnUi(el))
        .map((el, dom) => ({ el, dom, tabindex: Number(el.getAttribute("tabindex") ?? "0") || 0 }))
        .filter((n) => {
          const r = n.el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      focusOrder(nodes).forEach((n, i) => {
        const r = n.el.getBoundingClientRect();
        // Red marks a positive tabindex (a manual order that fights the DOM).
        const col = n.tabindex > 0 ? "#ff6b6b" : "#e8b54a";
        const badge = document.createElement("div");
        badge.textContent = String(i + 1);
        badge.style.cssText =
          `position:fixed;left:${r.left}px;top:${r.top}px;transform:translate(-50%,-50%);` +
          `font:700 10px/1 ui-monospace,monospace;color:#1a1407;background:${col};min-width:16px;height:16px;` +
          `display:flex;align-items:center;justify-content:center;padding:0 3px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.4);`;
        focusHost?.appendChild(badge);
      });
      return true;
    };

    // ---------- popover (open shadow root, isolated from page CSS) ----------
    // Option B surface: flat, solid, dark. No glass blur and no gold glow; the
    // translucent panel read busy over varied page content. Gold is an accent on
    // the border and the primary button only. Bigger hit targets on .lp-act.
    const POP_CSS = `
      .lp-pop { font-family: ui-sans-serif, system-ui, sans-serif; width: 300px; color: #f3f5f8;
        background: #161922; border: 1px solid rgba(232,181,74,.28);
        border-radius: 12px; padding: 12px 13px; box-shadow: 0 12px 30px rgba(0,0,0,.45); font-size: 13px; }
      .lp-head { display: flex; align-items: center; gap: 7px; }
      .lp-tag { font-weight: 700; color: #f6cf6e; font-size: 13px; }
      .lp-role { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #8b93a3; }
      .lp-name { font-size: 11.5px; color: #aab2c0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-score { margin-left: auto; font-size: 10.5px; font-weight: 600; color: #8b93a3; white-space: nowrap;
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); padding: 2px 8px; border-radius: 999px; }
      .lp-climb { color: #5fd0a8; border-color: rgba(95,208,168,.4); background: rgba(95,208,168,.1); }
      .lp-selrow { margin-top: 7px; }
      .lp-sel { font-family: ui-monospace, monospace; font-size: 10px; color: #e8b54a;
        background: rgba(232,181,74,.1); padding: 2px 6px; border-radius: 5px; display: inline-block; max-width: 100%;
        vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 7px; font-size: 10px; color: #8b93a3; }
      .lp-utarget { font-family: ui-monospace, monospace; color: #e8b54a; background: rgba(232,181,74,.1);
        padding: 1px 5px; border-radius: 4px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-shot { display: block; width: 100%; max-height: 140px; object-fit: contain;
        margin: 9px 0 2px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.25); }
      .lp-text { color: #aab2c0; font-size: 11.5px; margin: 7px 0 0; }
      .lp-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 11px; }
      .lp-subact { display: flex; gap: 6px; }
      .lp-act { font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; min-height: 34px; padding: 8px 12px;
        border-radius: 9px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #c4ccd8;
        display: inline-flex; align-items: center; justify-content: center; flex: 1; transition: border-color .15s, color .15s; }
      .lp-act:hover { border-color: rgba(232,181,74,.45); color: #f3f5f8; }
      .lp-gold { width: 100%; background: linear-gradient(180deg, rgba(232,181,74,.96), #c8902f); color: #1a1407; border: 0; }
      .lp-gold:hover { color: #1a1407; filter: brightness(1.04); }
      .lp-findings { margin-top: 11px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 9px; }
      .lp-findings > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; font-size: 11px; color: #8b93a3; }
      .lp-findings > summary::-webkit-details-marker { display: none; }
      .lp-findings > summary::before { content: "\\203A"; display: inline-block; transition: transform .15s; color: #6c7689; }
      .lp-findings[open] > summary::before { transform: rotate(90deg); }
      .lp-finding { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1);
        border-radius: 9px; padding: 8px 10px; margin: 8px 0 0; }
      .lp-finding b { font-size: 12px; }
      .lp-finding p { margin: 4px 0 0; color: #aab2c0; font-size: 11px; line-height: 1.45; }
      .lp-sev { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; }
      .lp-high { background: #ff6b6b; } .lp-medium { background: #ffb454; } .lp-low { background: #6c7689; }
      .lp-fix { font-family: ui-monospace, monospace; font-size: 10.5px; color: #5fd0a8; margin-top: 4px; }
      .lp-empty { color: #6c7689; font-size: 11.5px; padding: 9px 2px 2px; }`;

    const ensurePopover = (): void => {
      if (popHost) return;
      popHost = document.createElement("div");
      popHost.id = "loupe-lens-popover";
      popHost.style.cssText = "position:fixed;z-index:2147483647;display:none;";
      const root = popHost.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = POP_CSS;
      popBody = document.createElement("div");
      popBody.className = "lp-pop";
      root.append(style, popBody);
      document.documentElement.appendChild(popHost);
    };
    // Measure the rendered popover (call this after it is display:block) and let
    // the pure placer flip it above/below and clamp it inside the viewport,
    // instead of the old fixed 240/320 guesses that could cover the element near
    // an edge.
    const positionPopover = (el: Element): void => {
      if (!popHost) return;
      const r = el.getBoundingClientRect();
      const pop = popHost.getBoundingClientRect();
      const { top, left } = placePopover(
        r,
        { width: pop.width || 300, height: pop.height || 200 },
        { width: window.innerWidth, height: window.innerHeight },
      );
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
      popBody?.querySelectorAll<HTMLElement>("[data-action]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onAction(b.dataset["action"] ?? "", b);
        }),
      );
      if (popHost) popHost.style.display = "block";
      // Position only after display:block so the popover has real dimensions to
      // measure when deciding whether to sit above or below the element.
      if (current) positionPopover(current.el);
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

    // ---------- axe in Standalone (lazy: injected on first use) ----------
    type AxeRuntime = { run: (ctx: never, opts: object) => Promise<{ violations: unknown[] }> };
    const axeGlobal = (): AxeRuntime | undefined =>
      (window as unknown as { __loupeAxe?: AxeRuntime }).__loupeAxe;
    let axeInjecting: Promise<boolean> | null = null;
    const ensureAxe = (): Promise<boolean> => {
      if (axeGlobal()) return Promise.resolve(true);
      if (!axeInjecting) {
        axeInjecting = browser.runtime
          .sendMessage({ type: "inject-axe" })
          .then(() => Boolean(axeGlobal()))
          .catch(() => false);
        // let a failed injection be retried on the next audit
        void axeInjecting.then((ok) => {
          if (!ok) axeInjecting = null;
        });
      }
      return axeInjecting;
    };
    const axeFindings = async (context: Element | Document): Promise<Finding[]> => {
      try {
        if (!(await ensureAxe())) return [];
        const axe = axeGlobal();
        if (!axe) return [];
        // preload:false stops axe from XHR-fetching every cross-origin stylesheet
        // (its color-contrast precision aid). loupe contrast is computed in the
        // engine and we only read violations, so the preload only ever buys us a
        // "Couldn't load preload assets" warning on CDN-styled pages. Skip it.
        const res = await axe.run(context as never, {
          resultTypes: ["violations"],
          preload: false,
        });
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

    // Swap a popover button's label for a moment, then restore it. The popover's
    // copy had no feedback, so a write that silently succeeded and one that
    // silently failed looked identical.
    const flashLabel = (btn: HTMLElement | undefined, label: string, ms = 1200): void => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = label;
      window.setTimeout(() => {
        btn.textContent = prev;
      }, ms);
    };
    // The async clipboard API rejects from a content script when the document is
    // not focused; a hidden textarea + execCommand still copies without focus.
    const fallbackCopy = (text: string): boolean => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    };
    const copyPacket = (text: string, btn?: HTMLElement): void => {
      void navigator.clipboard.writeText(text).then(
        () => flashLabel(btn, "Copied"),
        () => flashLabel(btn, fallbackCopy(text) ? "Copied" : "Copy failed"),
      );
    };

    const onAction = (action: string, btn?: HTMLElement): void => {
      if (!current) return;
      if (action === "copy") {
        copyPacket(packetToMarkdown(current.packet), btn);
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

    // ---------- color-vision simulation overlay ----------
    // Inject one SVG color-matrix filter per deficiency, then filter <body>.
    // loupe's highlight and popover live on <html>, outside <body>, so they stay
    // true-color while the page below is simulated. Same matrices as the engine's
    // detector, so what you see is exactly what loupe flags.
    const SVG_NS = "http://www.w3.org/2000/svg";
    let cvdDefs = false;
    let priorBodyFilter: string | null = null;
    const ensureCvdDefs = (): void => {
      if (cvdDefs) return;
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.id = "loupe-cvd-defs";
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;";
      for (const type of Object.keys(CVD_MATRICES) as CvdType[]) {
        const filter = document.createElementNS(SVG_NS, "filter");
        filter.setAttribute("id", `loupe-cvd-${type}`);
        filter.setAttribute("color-interpolation-filters", "sRGB");
        const fe = document.createElementNS(SVG_NS, "feColorMatrix");
        fe.setAttribute("type", "matrix");
        fe.setAttribute("values", svgColorMatrix(type));
        filter.appendChild(fe);
        svg.appendChild(filter);
      }
      document.documentElement.appendChild(svg);
      cvdDefs = true;
    };
    const setVision = (cvd: CvdType | null): void => {
      const body = document.body;
      if (!body) return;
      if (priorBodyFilter === null) priorBodyFilter = body.style.filter;
      if (cvd) {
        ensureCvdDefs();
        body.style.filter = `url(#loupe-cvd-${cvd})`;
      } else {
        body.style.filter = priorBodyFilter || "";
        priorBodyFilter = null;
      }
    };

    // ---------- pointer wiring ----------
    // A click inside the open-shadow-root popover retargets to popHost at the
    // document level, so without this guard the capture-phase handler would
    // "select" loupe's own popover and its stopPropagation would keep the
    // popover buttons from ever firing. The same guard keeps the highlight off
    // our overlays.
    const isOwnUi = (t: EventTarget | null): boolean =>
      t === popHost || t === hl || (t instanceof Element && t.id === "loupe-cvd-defs");
    const onMove = (e: MouseEvent): void => {
      const el = e.target as Element | null;
      if (!inspecting || !el || isOwnUi(el)) return;
      moveHl(el);
      // Shift while a selection is live: measure the distance between the two.
      if (current && e.shiftKey && el !== current.el) {
        drawBetween(current.el, el);
        guideEl = null; // force a neighbor-guide redraw once Shift releases
      } else if (el !== guideEl) {
        // Recompute neighbor guides only when the hovered element changes.
        drawGuides(el);
        guideEl = el;
      }
    };
    const onClick = (e: MouseEvent): void => {
      if (!inspecting) return;
      if (isOwnUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      void onInspectClick(e.target as Element);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopInspecting();
        return;
      }
      // Enter fires the primary action when a selection is open: dispatch in
      // Connected, copy the packet in Standalone. Keyboard-first, no mouse reach.
      if (e.key === "Enter" && current) {
        e.preventDefault();
        const act = mode === "connected" ? "send" : "copy";
        const btn = popBody?.querySelector<HTMLElement>(`[data-action="${act}"]`) ?? undefined;
        onAction(act, btn);
      }
    };
    const startInspecting = (fromPanel = false): void => {
      if (inspecting) return;
      inspecting = true;
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      // Echo to the panel so its Inspect button tracks a keyboard-started inspect.
      if (!fromPanel) void browser.runtime.sendMessage({ type: "inspect-started" }).catch(() => {});
    };
    // fromPanel is true when the side panel drove the toggle (it already updated
    // its own button). The keyboard command and Escape leave it false, so we echo
    // the new state back to resync the panel's Inspect button.
    const stopInspecting = (fromPanel = false): void => {
      inspecting = false;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      hideHl();
      hidePopover();
      clearGuides();
      if (!fromPanel) void browser.runtime.sendMessage({ type: "inspect-stopped" }).catch(() => {});
    };

    // Collect the page's heading tree in document order for the outline view.
    const HEADING_SEL = "h1,h2,h3,h4,h5,h6,[role=heading]";
    const collectHeadings = (): { el: Element; level: number; text: string }[] =>
      Array.from(document.querySelectorAll(HEADING_SEL))
        .filter((el) => !isOwnUi(el))
        .map((el) => {
          const m = /^h([1-6])$/.exec(el.tagName.toLowerCase());
          const level = m ? Number(m[1]) : Number(el.getAttribute("aria-level")) || 2;
          return { el, level, text: (el.textContent ?? "").trim().slice(0, 80) };
        })
        .filter((h) => h.text.length > 0);

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type?: string;
        value?: boolean;
        mode?: "standalone" | "connected";
        agent?: string;
        selector?: string;
        property?: string;
        to?: string;
        cvd?: string;
        index?: number;
      };
      if (msg.type === "set-inspect") {
        if (msg.value) startInspecting(true);
        else stopInspecting(true);
      } else if (msg.type === "toggle-inspect") {
        if (inspecting) stopInspecting();
        else startInspecting();
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
      } else if (msg.type === "set-vision") {
        setVision((msg.cvd as CvdType | undefined) ?? null);
      } else if (msg.type === "find-overflow") {
        const count = showOverflow();
        void browser.runtime.sendMessage({ type: "overflow-result", count }).catch(() => {});
      } else if (msg.type === "toggle-focus-order") {
        const on = toggleFocusOrder();
        void browser.runtime.sendMessage({ type: "focus-order-result", on }).catch(() => {});
      } else if (msg.type === "get-outline") {
        const heads = collectHeadings();
        const outline = buildOutline(heads.map((h) => ({ level: h.level, text: h.text })));
        void browser.runtime
          .sendMessage({ type: "outline-result", entries: outline.entries, noH1: outline.noH1 })
          .catch(() => {});
      } else if (msg.type === "locate-heading" && typeof msg.index === "number") {
        const h = collectHeadings()[msg.index];
        if (h) {
          moveHl(h.el);
          h.el.scrollIntoView({ block: "center", behavior: "smooth" });
          window.setTimeout(hideHl, 1400);
        }
      }
    });
  },
});
