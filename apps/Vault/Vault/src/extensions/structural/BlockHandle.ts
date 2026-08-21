// Notion-style block drag handles: a grip in the left gutter that selects a
// block and drags it somewhere else.
//
// WHY THIS IS HAND-ROLLED rather than @tiptap/extension-drag-handle:
// that package imports `@tiptap/extension-collaboration` and `@tiptap/y-tiptap`
// at the top of its entry file, so adding it pulls the entire yjs
// collaborative-editing stack (~700 kB unpacked) into Vault's bundle — for a
// grip icon, in an app with no collaboration. This file is ~200 lines and adds
// no dependency at all.
//
// The mechanism is ProseMirror's own: set a NodeSelection on the block, then
// hand `view.dragging` a slice on dragstart. From there ProseMirror handles the
// drop, the drop cursor and the delete-from-origin itself, which is what keeps
// this small and keeps it correct for nested structures.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export const blockHandleKey = new PluginKey("vaultBlockHandle");

/** Horizontal band left of the content where hovering reveals the grip. */
const GUTTER_PROBE_PX = 80;

interface HandleState {
  el: HTMLElement;
  view: EditorView;
  /** Document position of the block the grip currently points at. */
  pos: number | null;
  lastProbe: number;
}

/**
 * Minimum gap between hit-tests while the pointer moves.
 *
 * A timestamp rather than requestAnimationFrame: rAF is throttled to zero in a
 * background tab, so an rAF-gated handler simply never runs there — which
 * makes the behaviour untestable and, more importantly, leaves the grip
 * frozen at a stale position when the tab comes back. 16ms is the same budget
 * a frame would have given it.
 */
const PROBE_INTERVAL_MS = 16;

/**
 * The TOP-LEVEL block under `coords`.
 *
 * Deliberately the outermost one: hovering a paragraph inside a callout offers
 * to drag the callout, and hovering a cell of a column row offers to drag the
 * row. Anything else is ambiguous — with nested containers there is no single
 * answer to "which block did you mean", and a handle that sometimes grabs the
 * inner block and sometimes the outer one is worse than one that is always
 * predictable. Rearranging *within* a container is an editing job.
 *
 * NOTE: resolve `found.pos`, not `found.inside`. `inside` is the position
 * *before* the node the coords fall in, so resolving it yields a depth-0
 * position and the walk below always answered "the first block in the
 * document" — the grip stuck to the heading no matter what was hovered.
 */
function blockAt(view: EditorView, x: number, y: number): { pos: number; node: any } | null {
  const found = view.posAtCoords({ left: x, top: y });
  if (!found) return null;

  const $pos = view.state.doc.resolve(Math.min(found.pos, view.state.doc.content.size));
  if ($pos.depth === 0) return null;

  const pos = $pos.before(1);
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.isText) return null;
  return { pos, node };
}

function positionHandle(state: HandleState, pos: number) {
  const dom = state.view.nodeDOM(pos) as HTMLElement | null;
  if (!dom || dom.nodeType !== 1) {
    state.el.style.display = "none";
    state.pos = null;
    return;
  }
  const rect = dom.getBoundingClientRect();
  const editorRect = state.view.dom.getBoundingClientRect();
  if (rect.height === 0) {
    // Inside a collapsed toggle — there is nothing to grab.
    state.el.style.display = "none";
    state.pos = null;
    return;
  }
  state.pos = pos;
  state.el.style.display = "flex";
  state.el.style.top = `${rect.top - editorRect.top + state.view.dom.scrollTop}px`;
  state.el.style.left = `${rect.left - editorRect.left - 28}px`;
}

export const BlockHandle = Extension.create({
  name: "blockHandle",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockHandleKey,

        view(view) {
          const el = document.createElement("div");
          el.className = "block-handle";
          el.setAttribute("contenteditable", "false");
          el.setAttribute("draggable", "true");
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", "Drag block");
          el.title = "Drag to move";
          el.innerHTML = '<span class="block-handle-grip" aria-hidden="true">⠿</span>';
          el.style.display = "none";
          view.dom.parentElement?.appendChild(el);

          const state: HandleState = { el, view, pos: null, lastProbe: 0 };

          function onMouseMove(e: MouseEvent) {
            const now = e.timeStamp || Date.now();
            if (now - state.lastProbe < PROBE_INTERVAL_MS) return;
            state.lastProbe = now;

            const editorRect = view.dom.getBoundingClientRect();
            if (e.clientX < editorRect.left - GUTTER_PROBE_PX || e.clientX > editorRect.right) return;
            // Probe slightly inside the content so a pointer out in the gutter
            // still resolves to the block beside it.
            const probeX = Math.max(e.clientX, editorRect.left + 4);
            const hit = blockAt(view, probeX, e.clientY);
            if (hit) positionHandle(state, hit.pos);
          }

          function onMouseLeave(e: MouseEvent) {
            // Keep it up while the pointer is on the grip itself, or it can
            // never be reached — it lives outside the editor's own box.
            if (el.contains(e.relatedTarget as Node)) return;
            el.style.display = "none";
            state.pos = null;
          }

          function selectBlock() {
            if (state.pos === null) return null;
            const sel = NodeSelection.create(view.state.doc, state.pos);
            view.dispatch(view.state.tr.setSelection(sel));
            return sel;
          }

          el.addEventListener("mousedown", (e) => {
            e.preventDefault(); // don't blur the editor
            view.focus();
            selectBlock();
          });

          el.addEventListener("dragstart", (e) => {
            const sel = selectBlock();
            if (!sel || !e.dataTransfer) {
              e.preventDefault();
              return;
            }
            const slice = new Slice(Fragment.from(sel.node), 0, 0);
            // Handing ProseMirror the slice is what makes the drop, the drop
            // cursor and the delete-from-origin its problem rather than ours.
            (view as any).dragging = { slice, move: true };
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/html", "");
            const dom = view.nodeDOM(sel.from) as HTMLElement | null;
            if (dom?.nodeType === 1) e.dataTransfer.setDragImage(dom, 8, 8);
            el.classList.add("is-dragging");
          });

          el.addEventListener("dragend", () => {
            el.classList.remove("is-dragging");
            (view as any).dragging = null;
          });

          view.dom.addEventListener("mousemove", onMouseMove);
          view.dom.addEventListener("mouseleave", onMouseLeave);
          el.addEventListener("mouseenter", () => {
            el.style.display = "flex";
          });

          return {
            update: () => {
              // A doc change can move or remove the hovered block; re-anchor
              // rather than leave the grip floating over unrelated content.
              if (state.pos !== null) positionHandle(state, state.pos);
            },
            destroy: () => {
              view.dom.removeEventListener("mousemove", onMouseMove);
              view.dom.removeEventListener("mouseleave", onMouseLeave);
              el.remove();
            },
          };
        },
      }),
    ];
  },
});
