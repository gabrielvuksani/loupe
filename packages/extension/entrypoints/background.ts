// Opens the Lens side panel when the toolbar icon is clicked.
export default defineBackground(() => {
  const sidePanel = (browser as unknown as {
    sidePanel?: { setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void> };
  }).sidePanel;
  void sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
