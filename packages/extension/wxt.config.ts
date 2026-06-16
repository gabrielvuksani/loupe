import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "goldeye Lens",
    description: "Deterministic design & accessibility verdicts on any page. AI only applies.",
    permissions: ["activeTab", "scripting", "sidePanel", "tabs"],
    action: { default_title: "Open the goldeye Lens" },
    side_panel: { default_path: "sidepanel.html" },
  },
});
