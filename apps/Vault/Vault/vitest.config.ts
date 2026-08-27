import path from "path";
import { defineConfig } from "vitest/config";

// Deliberately narrow: these tests cover the note schema and the guard that
// protects stored content from it. No React, no rendering, no component tests —
// those are verified by hand. The value here is that schema/serialization
// mistakes are the ones that silently eat documents, and they're exactly the
// ones a type checker can't see.
//
// ProseMirror's DOMSerializer/DOMParser (which generateHTML/generateJSON sit
// on) need a real document. It's installed from a setup file rather than via
// `environment: "happy-dom"` — see src/test/domSetup.ts for why.
export default defineConfig({
  // A vitest.config.ts REPLACES vite.config.ts rather than merging with it, so
  // every alias the app relies on has to be repeated here or it silently is not
  // applied. That divergence is invisible until it isn't: `@nexus/core/*` then
  // falls through to Node resolution via the node_modules symlink, which points
  // at the repo root — so in a git worktree the tests resolve nexus-core from
  // the MAIN checkout, and twelve unrelated test files fail to load with
  // `Missing "./pathfinder" specifier` the moment that checkout is on an older
  // commit than the branch under test.
  //
  // Deep specifiers only, and the bare "@nexus/core" barrel is deliberately
  // absent: the barrel re-exports AppGraph3D and therefore three.js, which has
  // no business loading in a node-environment schema test. Same ordering
  // reasoning as vite.config.ts — the longest prefix must come first.
  resolve: {
    alias: {
      "@nexus/core/pathfinder": path.resolve(__dirname, "../../../packages/nexus-core/src/pathfinder/index.ts"),
      "@nexus/core/members": path.resolve(__dirname, "../../../packages/nexus-core/src/members.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/domSetup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
