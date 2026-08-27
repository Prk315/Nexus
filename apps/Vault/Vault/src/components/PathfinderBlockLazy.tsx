// The node view, behind a dynamic import.
//
// This indirection is about coupling, not only bundle size.
//
// `lib/noteSchemaGuard.ts` derives the editor schema by calling
// `buildNoteExtensions()` — the whole reason the extension list lives in one
// module is that the schema must be buildable BEFORE an editor exists. If the
// node imported its view directly, building the schema would transitively
// import `lib/pathfinderStore.ts` → `lib/supabase.ts`, which calls
// `createClient()` at MODULE SCOPE and throws "supabaseUrl is required" when
// the env vars are absent. Deciding whether a note is safe to open would then
// depend on a configured network client, which is backwards: the guard's job is
// to run when things are broken.
//
// The rule for any future data-backed block: the NODE may only import something
// that itself imports nothing heavier than React and Tiptap. The data layer is
// reached through the dynamic import below, once the block is actually on screen.

import { Suspense } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { lazyWithReload } from "../lib/lazyLoad";

const Inner = lazyWithReload(() =>
  import("./PathfinderBlockView").then((m) => ({ default: m.PathfinderBlockView })),
);

export function PathfinderBlockLazy(props: NodeViewProps) {
  return (
    <Suspense
      fallback={
        // Same outer shell and roughly the same height as the real block, so
        // the note doesn't reflow when the chunk lands.
        <NodeViewWrapper className="pf-block is-booting" contentEditable={false}>
          <div className="pf-skeleton" aria-busy="true" aria-label="Loading tasks">
            <div className="pf-skeleton-row" />
            <div className="pf-skeleton-row" />
          </div>
        </NodeViewWrapper>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
}
