import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
      "@nexus/core": path.resolve(__dirname, "../../../packages/nexus-core/src/index.ts"),
    },
    // Force a single `three` instance. App.tsx + @nexus/core import three from
    // source while react-force-graph-3d ships its own pre-bundled three; without
    // dedupe you get two THREE globals and three-forcegraph crashes inside
    // tickFrame ("Cannot read properties of undefined (reading 'tick')").
    dedupe: ["three", "react", "react-dom"],
  },
  // @nexus/core is aliased to source, so Vite has to discover its heavy
  // transitive deps (three / drei / fiber). Pre-bundle them upfront so Vite
  // doesn't hit an on-demand re-optimize loop that AV (AVG on this box) can
  // catch mid-write, leaving chunks half-deleted.
  optimizeDeps: {
    include: [
      'smiles-drawer',
      'three',
      'three-spritetext',
      'react-force-graph-2d',
      'react-force-graph-3d',
      'pdfjs-dist',
      '@react-three/fiber',
      '@react-three/drei',
      '@tiptap/react',
      '@tiptap/starter-kit',
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
