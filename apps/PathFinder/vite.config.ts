import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexus/core": path.resolve(__dirname, "../../packages/nexus-core/src/index.ts"),
    },
  },

  // @nexus/core is aliased to source, so Vite has to discover its heavy
  // transitive deps. Pre-bundle them upfront so Vite doesn't hit an
  // on-demand re-optimize loop that leaves bundles half-written.
  optimizeDeps: {
    include: [
      "@react-three/fiber",
      "@react-three/drei",
      "three",
      "@xyflow/react",
      "recharts",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1422,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
