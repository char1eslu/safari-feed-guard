import { defineConfig } from "wxt";

// x-spam-sentinel — strictly passive. Only localhost host permission; no
// X host permissions beyond the content-script match (we only read the DOM
// already rendered for the user).
export default defineConfig({
  // Don't spawn a throwaway browser profile on `wxt dev`. Load the built
  // .output/chrome-mv3 into your own Chrome (logged into X) manually; WXT
  // still watches + hot-reloads it.
  webExt: { disabled: true },
  manifest: {
    name: "x-spam-sentinel",
    description:
      "Passive AI spam / porn-bot detection for X. Public-good, open source.",
    permissions: ["storage"],
    host_permissions: [
      "https://x-spam-sentinel-edge.zuoluotv.workers.dev/*",
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: { default_title: "x-spam-sentinel" },
    options_ui: { open_in_tab: true },
  },
});
