import { defineConfig } from "vitest/config";

// Tests are pure: Markdown <-> TipTap JSON, tree walking, profile storage on a
// temp dir, and PathFinder commands against a mocked PathfinderApi. Nothing here
// opens a network connection, so no Supabase env is needed to run them.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
