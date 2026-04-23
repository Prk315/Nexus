import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexus/core": path.resolve(__dirname, "../../packages/nexus-core/src/index.ts"),
    },
  },
  clearScreen: false,
  server: {
    port: 1424,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})
