// Opens the Lens side panel on toolbar click, captures the visible tab for the
// element screenshot, and injects the axe runtime on demand (kept out of the
// per-page content bundle).
export default defineBackground(() => {
  const api = browser as unknown as {
    sidePanel?: { setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void> };
    tabs: { captureVisibleTab: (o?: { format?: string }) => Promise<string> };
    scripting: { executeScript: (o: { target: { tabId: number }; files: string[] }) => Promise<unknown> };
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
});
