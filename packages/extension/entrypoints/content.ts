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
      .lp-pop { font-family: ui-sans-serif, system-ui, sans-serif; width: 300px; color: #f3f5f8;
        background: rgba(20,23,31,.94); backdrop-filter: blur(14px); border: 1px solid rgba(232,181,74,.3);
        border-radius: 14px; padding: 12px 13px; box-shadow: 0 18px 50px rgba(0,0,0,.5); font-size: 13px; }
      .lp-head { display: flex; align-items: center; gap: 8px; }
      .lp-tag { font-weight: 700; color: #f6cf6e; }
      .lp-sel { font-family: ui-monospace, monospace; font-size: 10px; color: #e8b54a;
        background: rgba(232,181,74,.12); padding: 2px 6px; border-radius: 5px; flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-score { font-weight: 700; }
      .lp-climb { color: #5fd0a8; }
      .lp-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; font-size: 10px; color: #8b93a3; }
      .lp-utarget { font-family: ui-monospace, monospace; color: #e8b54a; background: rgba(232,181,74,.1);
        padding: 1px 5px; border-radius: 4px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lp-shot { display: block; width: 100%; max-height: 150px; object-fit: contain;
        margin: 9px 0 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.25); }
      .lp-text { color: #aab2c0; font-size: 11.5px; margin: 7px 0; }
      .lp-finding { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1);
        border-radius: 10px; padding: 9px 10px; margin: 8px 0; }
      .lp-finding b { font-size: 12px; }
      .lp-finding p { margin: 4px 0; color: #aab2c0; font-size: 11px; line-height: 1.45; }
      .lp-sev { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; }
      .lp-high { background: #ff6b6b; } .lp-medium { background: #ffb454; } .lp-low { background: #6c7689; }
      .lp-fix { font-family: ui-monospace, monospace; font-size: 10.5px; color: #5fd0a8; }
      .lp-empty { color: #6c7689; font-size: 12px; padding: 8px 2px; }
      .lp-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      .lp-act { font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; padding: 7px 11px;
        border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #aab2c0; }
      .lp-gold { background: linear-gradient(180deg, rgba(232,181,74,.95), #c8902f); color: #1a1407; border: 0; flex: 1; }`;

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
      if (inspecting && el && !isOwnUi(el)) moveHl(el);
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
      }
    };
    const startInspecting = (): void => {
      if (inspecting) return;
      inspecting = true;
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    };
    // fromPanel is true when the side panel toggled inspect off (it already
    // updated its own button); Escape in the page leaves it false, so we echo
    // inspect-stopped back to resync the panel's Inspect button.
    const stopInspecting = (fromPanel = false): void => {
      inspecting = false;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      hideHl();
      hidePopover();
      if (!fromPanel) void browser.runtime.sendMessage({ type: "inspect-stopped" });
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
        cvd?: string;
      };
      if (msg.type === "set-inspect") {
        if (msg.value) startInspecting();
        else stopInspecting(true);
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
      }
    });
  },
});
