import {
  analyzeElement,
  analyzePage,
  buildPacket,
  captureElement,
  capturePage,
  packetToMarkdown,
  scoreFindings,
} from "@goldeye/engine";

// Content script: capture snapshots, run the engine in-page, stream to the panel.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let inspecting = false;
    let hl: HTMLElement | null = null;

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

    const onMove = (e: MouseEvent): void => {
      const el = e.target as Element | null;
      if (inspecting && el && el !== hl) moveHl(el);
    };
    const onClick = (e: MouseEvent): void => {
      if (!inspecting) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target as Element;
      const snap = captureElement(el);
      const packet = buildPacket(snap, analyzeElement(snap));
      void browser.runtime.sendMessage({
        type: "element-result",
        packet,
        markdown: packetToMarkdown(packet),
      });
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type?: string; value?: boolean; selector?: string; property?: string; to?: string };
      if (msg.type === "set-inspect") {
        inspecting = Boolean(msg.value);
        if (inspecting) {
          document.addEventListener("mousemove", onMove, true);
          document.addEventListener("click", onClick, true);
        } else {
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("click", onClick, true);
          hideHl();
        }
      } else if (msg.type === "analyze-page") {
        const page = capturePage(document);
        const findings = analyzePage(page);
        void browser.runtime.sendMessage({
          type: "page-result",
          findings,
          score: scoreFindings(findings),
        });
      } else if (msg.type === "locate" && msg.selector) {
        const el = document.querySelector(msg.selector);
        if (el) {
          moveHl(el);
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          window.setTimeout(hideHl, 1400);
        }
      } else if (msg.type === "preview-fix" && msg.selector && msg.property && msg.to) {
        const el = document.querySelector(msg.selector) as HTMLElement | null;
        if (el) {
          const prop = msg.property.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
          el.style.setProperty(msg.property, msg.to);
          void prop;
        }
      }
    });
  },
});
