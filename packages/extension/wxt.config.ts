import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "goldeye Lens",
    description: "Deterministic design & accessibility verdicts on any page. AI only applies.",
    permissions: ["activeTab", "scripting", "sidePanel", "tabs"],
    // The content script already matches <all_urls>; this lets scripting inject
    // the on-demand axe runtime on any page (and bypass page CSP) without a
    // per-audit gesture. No broader data access than the content script already has.
    host_permissions: ["<all_urls>"],
    action: { default_title: "Open the goldeye Lens" },
    side_panel: { default_path: "sidepanel.html" },
  },
});
