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
  test: {
    environment: "node",
    setupFiles: ["./src/test/domSetup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
