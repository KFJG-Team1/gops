import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const backendTarget = env.VITE_BACKEND_TARGET ?? process.env.VITE_BACKEND_TARGET ?? "http://127.0.0.1:8000";
  const websocketTarget = backendTarget.replace(/^http/, "ws");
  const logoDevPublishableKey = env.LOGODEV_PUB_KEY ?? env.VITE_LOGO_DEV_PUBLISHABLE_KEY ?? "";
  const logoDevAttribution = env.VITE_LOGO_DEV_ATTRIBUTION ?? env.LOGODEV_ATTRIBUTION ?? "true";

  return {
    envDir: repoRoot,
    define: {
      __GOPS_LOGO_DEV_PUBLISHABLE_KEY__: JSON.stringify(logoDevPublishableKey),
      __GOPS_LOGO_DEV_ATTRIBUTION__: JSON.stringify(logoDevAttribution)
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@gops/chart-engine": fileURLToPath(new URL("../chart-engine/src", import.meta.url))
      }
    },
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
              return "vendor-react";
            }
            if (id.includes("/node_modules/d3-") || id.includes("/node_modules/d3/")) {
              return "vendor-d3";
            }
            if (id.includes("/node_modules/lucide-react/")) {
              return "vendor-icons";
            }
            if (id.includes("/apps/chart-engine/")) {
              return "chart-engine";
            }
            if (id.includes("/src/market/sp500Universe.seed")) {
              return "market-universe";
            }
            if (id.includes("/src/agent/") || id.includes("/src/agents/")) {
              return "feature-agent";
            }
            if (id.includes("/src/ontology/")) {
              return "feature-ontology";
            }
            if (id.includes("/src/alerts/")) {
              return "feature-alerts";
            }
            if (id.includes("/src/recommendations/")) {
              return "feature-recommendations";
            }
            if (
              id.includes("/src/chart/czardas")
              || id.endsWith("/src/components/CzardasLayerToggles.tsx")
              || id.endsWith("/src/components/ChartAssetOpsPanel.tsx")
              || id.endsWith("/src/components/ChartCommentaryPanel.tsx")
            ) {
              return "feature-czardas";
            }
            if (id.includes("/src/layout/")) {
              return "workspace-layout";
            }
            return undefined;
          }
        }
      }
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["stargops.com", "www.stargops.com"],
      proxy: {
        "/api": backendTarget,
        "/ws": {
          target: websocketTarget,
          ws: true
        }
      }
    }
  };
});
