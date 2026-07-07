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
