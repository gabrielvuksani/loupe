// Opens the Lens side panel on toolbar click, captures the visible tab for the
// element screenshot, and injects the axe runtime on demand (kept out of the
// per-page content bundle).
export default defineBackground(() => {
  const api = browser as unknown as {
    sidePanel?: { setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void> };
    tabs: {
      captureVisibleTab: (o?: { format?: string }) => Promise<string>;
      query: (o: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number }>>;
      sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
    };
    scripting: { executeScript: (o: { target: { tabId: number }; files: string[] }) => Promise<unknown> };
    commands?: { onCommand: { addListener: (cb: (command: string) => void) => void } };
  };
  void api.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener(
    (msg: unknown, sender, sendResponse: (r: unknown) => void): boolean | undefined => {
      const type = (msg as { type?: string })?.type;
      if (type === "capture-visible") {
        api.tabs
          .captureVisibleTab({ format: "png" })
          .then((d) => sendResponse(d))
          .catch(() => sendResponse(null));
        return true; // keep the channel open for the async response
      }
      if (type === "inject-axe") {
        const tabId = (sender as { tab?: { id?: number } }).tab?.id;
        if (tabId == null) {
          sendResponse(false);
          return true;
        }
        api.scripting
          .executeScript({ target: { tabId }, files: ["axe.js"] })
          .then(() => sendResponse(true))
          .catch(() => sendResponse(false));
        return true;
      }
      return undefined;
    },
  );

  // Keyboard command: toggle inspect on the active tab, injecting the content
  // script first if the tab predates the extension (the same fallback the panel
  // uses). The content script echoes the new state so the panel button stays in
  // sync.
  const toggleInspectActiveTab = async (): Promise<void> => {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const id = tab?.id;
    if (id == null) return;
    try {
      await api.tabs.sendMessage(id, { type: "toggle-inspect" });
    } catch {
      try {
        await api.scripting.executeScript({ target: { tabId: id }, files: ["/content-scripts/content.js"] });
        await api.tabs.sendMessage(id, { type: "toggle-inspect" });
      } catch {
        /* a page loupe cannot reach (chrome://, store) */
      }
    }
  };
  api.commands?.onCommand.addListener((command) => {
    if (command === "toggle-inspect") void toggleInspectActiveTab();
  });
});
