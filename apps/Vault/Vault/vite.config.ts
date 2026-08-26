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
      // Deep specifier FIRST — Vite matches alias keys in order, so the bare
      // "@nexus/core" entry below would otherwise swallow "@nexus/core/members"
      // and resolve it to the barrel (which drags in three.js).
      "@nexus/core/members": path.resolve(__dirname, "../../../packages/nexus-core/src/members.ts"),
      "@nexus/core": path.resolve(__dirname, "../../../packages/nexus-core/src/index.ts"),
    },
    // Force a single `three` instance. App.tsx + @nexus/core import three from
    // source while react-force-graph-3d ships its own pre-bundled three; without
    // dedupe you get two THREE globals and three-forcegraph crashes inside
    // tickFrame ("Cannot read properties of undefined (reading 'tick')").
    //
    // `yjs` is here for the identical reason and it is not optional: Yjs uses
    // `instanceof` internally (Y.Doc, Y.XmlFragment, the AbstractType
    // hierarchy), so two copies make Y.applyUpdate silently no-op rather than
    // throw — live co-editing would look connected and simply never converge.
    // `@tiptap/core` joins it because the collaboration packages pin it to an
    // exact version while some of Vault's own tiptap deps use ranges.
    dedupe: ["three", "react", "react-dom", "yjs", "@tiptap/core"],
  },
  // @nexus/core is aliased to source, so Vite has to discover its heavy
  // transitive deps (three / drei / fiber). Pre-bundle them upfront so Vite
  // doesn't hit an on-demand re-optimize loop that AV (AVG on this box) can
  // catch mid-write, leaving chunks half-deleted.
  optimizeDeps: {
    include: [
      'smiles-drawer',
      'sql.js',
      'three',
      'three-spritetext',
      'react-force-graph-2d',
      'react-force-graph-3d',
      'pdfjs-dist',
      '@react-three/fiber',
      '@react-three/drei',
      '@tiptap/react',
      '@tiptap/starter-kit',
      // The live co-editing stack. These only ever load behind the dynamic
      // import in src/collab/loadCollab.ts, so without pre-bundling the FIRST
      // time anyone opens a shared note Vite kicks off an on-demand
      // re-optimize and full page reload — mid-edit, and exactly the
      // half-written-chunk window the comment above warns about.
      'yjs',
      'y-protocols/awareness',
      '@tiptap/y-tiptap',
      '@tiptap/extension-collaboration',
      '@tiptap/extension-collaboration-caret',
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
