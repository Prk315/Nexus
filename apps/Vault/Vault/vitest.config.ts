import { defineConfig } from "vitest/config";
import path from "path";

// Deliberately narrow: these tests cover the note schema and the guard that
// protects stored content from it. No React, no rendering, no component tests —
// those are verified by hand. The value here is that schema/serialization
// mistakes are the ones that silently eat documents, and they're exactly the
// ones a type checker can't see.
//
// ProseMirror's DOMSerializer/DOMParser (which generateHTML/generateJSON sit
// on) need a real document. It's installed from a setup file rather than via
// `environment: "happy-dom"` — see src/test/domSetup.ts for why.
// ⚠️ **This file REPLACES vite.config.ts for tests — it does not merge with it.**
// Vitest loads `vitest.config.ts` in preference to `vite.config.ts` when both
// exist, so every `resolve.alias` the app builds against has to be repeated
// here or it simply is not applied under test.
//
// Without them `@nexus/core/*` falls through to Node resolution, which follows
// the `node_modules/@nexus/core` workspace SYMLINK — and that symlink points at
// the primary checkout, not at the tree the test is running in. A git worktree
// (or a branch that adds an export) therefore tests against a different copy of
// nexus-core than it compiles against, and the failure is a resolution error
// with no obvious connection to the change that caused it:
//
//     Missing "./pathfinder" specifier in "@nexus/core" package
//
// Aliasing to source removes the symlink from the path entirely, so the tests
// see exactly the files `vite build` would.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deep aliases before the barrel, in the same order as vite.config.ts —
      // Vite matches keys in order, so a leading "@nexus/core" entry would
      // swallow both and drag three.js into the schema tests.
      "@nexus/core/pathfinder": path.resolve(__dirname, "../../../packages/nexus-core/src/pathfinder/index.ts"),
      "@nexus/core/members": path.resolve(__dirname, "../../../packages/nexus-core/src/members.ts"),
      "@nexus/core": path.resolve(__dirname, "../../../packages/nexus-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/domSetup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
