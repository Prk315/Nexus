import { defineConfig } from "vitest/config";

// Tests are pure: Markdown <-> TipTap JSON, tree walking, profile storage on a
// temp dir, the board's data shaping, its panes rendered to a string with
// ink-testing-library, and every PathFinder/board write against a mocked
// PathfinderApi. Nothing here opens a network connection, so no Supabase env is
// needed to run them — and nothing can reach the personal account.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
