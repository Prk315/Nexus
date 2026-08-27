// The PathFinder task block, hosted on the canvas.
//
// Mirrors PathfinderBlockLazy: the heavy half — the store, the filter bar, the
// three views — arrives through a dynamic import once the block is on screen.
// CanvasEditor is itself lazy-loaded, so a static import here would not break
// anything, but it would put the whole PathFinder data layer into the canvas
// chunk for every canvas that has no task block on it.
//
// The block itself is NOT duplicated: `PathfinderBlock` is the same component
// the note renders, with the Tiptap-specific bits (NodeViewWrapper,
// editor.isEditable, node.attrs) passed in as props instead of assumed. See
// PathfinderBlockHostProps.

import { Suspense } from "react";
import { lazyWithReload } from "../lib/lazyLoad";

const Inner = lazyWithReload(() =>
  import("./PathfinderBlockView").then((m) => ({
    default: function CanvasHost(p: {
      view: string; spec: string; title: string;
      onChange: (patch: { view?: string; spec?: string; title?: string }) => void;
    }) {
      return (
        <m.PathfinderBlock
          attrs={{ view: p.view, spec: p.spec, title: p.title }}
          setAttrs={p.onChange}
          // A canvas block is always editable — there is no read-only canvas —
          // and "selected" is the canvas's own chrome, drawn by the block
          // wrapper outside this component rather than by the block itself.
          editable
          selected={false}
          Wrapper={m.PlainBlockWrapper}
        />
      );
    },
  })),
);

export function CanvasPathfinderBlock(props: {
  view: string; spec: string; title: string;
  onChange: (patch: { view?: string; spec?: string; title?: string }) => void;
}) {
  return (
    <Suspense
      fallback={
        <div className="pf-block is-booting">
          <div className="pf-skeleton" aria-busy="true" aria-label="Loading tasks">
            <div className="pf-skeleton-row" />
            <div className="pf-skeleton-row" />
          </div>
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
}
