import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexus/core/coverage": path.resolve(__dirname, "../../packages/nexus-core/src/coverage.ts"),
      "@nexus/core": path.resolve(__dirname, "../../packages/nexus-core/src/index.ts"),
    },
  },
  clearScreen: false,
  server: {
    port: 1426,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1426 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("katex")) return "katex";
          if (
            id.includes("react-markdown") ||
            id.includes("/remark-") ||
            id.includes("/rehype-") ||
            id.includes("mdast") ||
            id.includes("micromark") ||
            id.includes("unist-") ||
            id.includes("unified") ||
            id.includes("hast-") ||
            id.includes("vfile")
          ) {
            return "markdown";
          }
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "react-vendor";
          }
          if (id.includes("@supabase/supabase-js") || id.includes("@supabase/")) {
            return "supabase";
          }
          return undefined;
        },
      },
    },
  },
});
