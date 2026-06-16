// Opens the Lens side panel on toolbar click, and captures the visible tab when
// the content script asks (for the element screenshot in the packet).
export default defineBackground(() => {
  const api = browser as unknown as {
    sidePanel?: { setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void> };
    tabs: { captureVisibleTab: (o?: { format?: string }) => Promise<string> };
  };
  void api.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse: (r: unknown) => void): boolean | undefined => {
      if ((msg as { type?: string })?.type === "capture-visible") {
        api.tabs
          .captureVisibleTab({ format: "png" })
          .then((d) => sendResponse(d))
          .catch(() => sendResponse(null));
        return true; // keep the channel open for the async response
      }
      return undefined;
    },
  );
});
