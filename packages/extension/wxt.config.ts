import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "Loupe",
    description: "Find design and accessibility problems on any page, with the exact fix. Your coding agent applies it.",
    permissions: ["activeTab", "scripting", "sidePanel", "tabs"],
    // The content script already matches <all_urls>; this lets scripting inject
    // the on-demand axe runtime on any page (and bypass page CSP) without a
    // per-audit gesture. No broader data access than the content script already has.
    host_permissions: ["<all_urls>"],
    action: { default_title: "Open Loupe" },
    side_panel: { default_path: "sidepanel.html" },
  },
});
