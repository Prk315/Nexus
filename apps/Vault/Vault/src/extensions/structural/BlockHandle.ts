// Notion-style block drag handles: a grip in the left gutter that picks a
// block up and drops it somewhere else.
//
// WHY THIS IS HAND-ROLLED rather than @tiptap/extension-drag-handle:
// that package imports `@tiptap/extension-collaboration` and `@tiptap/y-tiptap`
// at the top of its entry file, so adding it pulls the entire yjs
// collaborative-editing stack (~700 kB unpacked) into Vault's bundle — for a
// grip icon, in an app with no collaboration.
//
// WHY POINTER EVENTS RATHER THAN NATIVE HTML5 DRAG-AND-DROP:
// the first version handed ProseMirror a slice on `dragstart` and let it own
// the drop. It never worked, for a reason that is easy to miss — the grip's
// `mousedown` handler called preventDefault() to stop the editor blurring, and
// preventing the default on mousedown is precisely what stops the browser
// starting a drag on a draggable element. The two requirements are in direct
// conflict. Native DnD inside contenteditable is also awkward to test and
// varies across the WebViews this app ships in. A pointer-driven drag has
// neither problem, is verifiable with synthetic events, and gets us a real
// drop indicator instead of relying on a drop cursor plugin.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export const blockHandleKey = new PluginKey("vaultBlockHandle");

/** Horizontal band left of the content where hovering reveals the grip. */
const GUTTER_PROBE_PX = 80;

/**
 * Minimum gap between hit-tests while the pointer moves.
 *
 * A timestamp rather than requestAnimationFrame: rAF is throttled to zero in a
 * background tab, so an rAF-gated handler simply never runs there — which
 * makes the behaviour untestable and leaves the grip frozen at a stale
 * position when the tab comes back. 16ms is the same budget a frame gives it.
 */
const PROBE_INTERVAL_MS = 16;

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface HandleState {
  el: HTMLElement;
  indicator: HTMLElement;
  view: EditorView;
  /** Document position of the block the grip currently points at. */
  pos: number | null;
  lastProbe: number;
}

interface DragState {
  /** Position of the block being moved, in the doc as it was at pointerdown. */
  from: number;
  /** Where it would land: position of a top-level boundary. */
  to: number | null;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

/**
 * The TOP-LEVEL block under `coords`.
 *
 * Deliberately the outermost one: hovering a paragraph inside a callout offers
 * to drag the callout, and hovering a cell of a column row offers to drag the
 * row. With nested containers there is no single answer to "which block did
 * you mean", and a handle that sometimes grabs the inner block and sometimes
 * the outer one is worse than one that is always predictable.
 *
 * NOTE: resolve `found.pos`, not `found.inside`. `inside` is the position
 * *before* the node the coords fall in, so resolving it yields a depth-0
 * position and this always answered "the first block in the document" — the
 * grip stuck to the heading no matter what was hovered.
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
  if (rect.height === 0) {
    // Inside a collapsed toggle — there is nothing to grab.
    state.el.style.display = "none";
    state.pos = null;
    return;
  }
  const editorRect = state.view.dom.getBoundingClientRect();
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
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", "Drag block");
          el.title = "Drag to move";
          el.innerHTML = '<span class="block-handle-grip" aria-hidden="true">⠿</span>';
          el.style.display = "none";

          // Where the block would land. A line rather than a ghost, because a
          // ghost of a whole table tells you nothing about the insertion point.
          const indicator = document.createElement("div");
          indicator.className = "block-drop-indicator";
          indicator.style.display = "none";
          indicator.setAttribute("contenteditable", "false");

          const host = view.dom.parentElement;
          host?.appendChild(el);
          host?.appendChild(indicator);

          const state: HandleState = { el, indicator, view, pos: null, lastProbe: 0 };
          let drag: DragState | null = null;

          // ── Hover: follow the block under the pointer ───────────────────────
          function onMouseMove(e: MouseEvent) {
            if (drag) return; // a drag owns the pointer; don't re-anchor
            // ONE clock, always. This was `e.timeStamp || Date.now()`, which
            // mixes two unrelated time bases: e.timeStamp is milliseconds since
            // page load (small), Date.now() is milliseconds since 1970 (huge).
            // A single event with timeStamp 0 pushes lastProbe to epoch scale,
            // after which every real event compares as "too soon" and the grip
            // silently stops appearing for the rest of the session.
            const now = performance.now();
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
            if (drag) return;
            // Keep it up while the pointer is on the grip itself, or it can
            // never be reached — it lives outside the editor's own box.
            if (el.contains(e.relatedTarget as Node)) return;
            el.style.display = "none";
            state.pos = null;
          }

          // ── Drop target ────────────────────────────────────────────────────
          /**
           * Nearest top-level boundary to `clientY`: before the hovered block
           * if the pointer is in its upper half, after it otherwise.
           */
          function dropTargetAt(clientX: number, clientY: number): number | null {
            const editorRect = view.dom.getBoundingClientRect();
            const probeX = Math.min(
              Math.max(clientX, editorRect.left + 4),
              editorRect.right - 4
            );
            const hit = blockAt(view, probeX, clientY);
            if (!hit) return null;
            const dom = view.nodeDOM(hit.pos) as HTMLElement | null;
            if (!dom || dom.nodeType !== 1) return null;
            const r = dom.getBoundingClientRect();
            const after = clientY > r.top + r.height / 2;
            return after ? hit.pos + hit.node.nodeSize : hit.pos;
          }

          function showIndicator(at: number) {
            const doc = view.state.doc;
            const editorRect = view.dom.getBoundingClientRect();
            // A boundary sits between two top-level nodes; anchor the line to
            // the bottom of the node before it, or the top of the doc.
            let top: number;
            let left = editorRect.left;
            let width = editorRect.width;

            const $at = doc.resolve(Math.min(at, doc.content.size));
            const index = $at.index(0);
            const nodeBefore = index > 0 ? doc.child(index - 1) : null;
            const anchorPos = nodeBefore ? at - nodeBefore.nodeSize : at;
            const anchorDom = view.nodeDOM(Math.max(0, Math.min(anchorPos, doc.content.size - 1))) as HTMLElement | null;

            if (anchorDom && anchorDom.nodeType === 1) {
              const r = anchorDom.getBoundingClientRect();
              top = nodeBefore ? r.bottom : r.top;
              left = r.left;
              width = r.width;
            } else {
              top = editorRect.top;
            }

            indicator.style.display = "block";
            indicator.style.top = `${top - editorRect.top + view.dom.scrollTop - 1}px`;
            indicator.style.left = `${left - editorRect.left}px`;
            indicator.style.width = `${width}px`;
          }

          function hideIndicator() {
            indicator.style.display = "none";
          }

          // ── The drag itself ────────────────────────────────────────────────
          function endDrag(commit: boolean) {
            const d = drag;
            drag = null;
            hideIndicator();
            el.classList.remove("is-dragging");
            document.body.classList.remove("vault-block-dragging");
            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onDragUp);
            window.removeEventListener("pointercancel", onDragCancel);
            window.removeEventListener("keydown", onDragKey, true);
            if (!d) return;
            try {
              el.releasePointerCapture(d.pointerId);
            } catch {
              /* the pointer may already be gone */
            }
            if (!commit || !d.active || d.to === null || view.isDestroyed) return;
            moveBlock(d.from, d.to);
          }

          function onDragMove(e: PointerEvent) {
            if (!drag || e.pointerId !== drag.pointerId) return;
            e.preventDefault();
            if (!drag.active) {
              const moved =
                Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
              if (moved < DRAG_THRESHOLD_PX) return; // still a click, not a drag
              drag.active = true;
              el.classList.add("is-dragging");
              document.body.classList.add("vault-block-dragging");
            }
            const to = dropTargetAt(e.clientX, e.clientY);
            drag.to = to;
            if (to === null) hideIndicator();
            else showIndicator(to);
          }

          function onDragUp(e: PointerEvent) {
            if (!drag || e.pointerId !== drag.pointerId) return;
            endDrag(true);
          }

          function onDragCancel(e: PointerEvent) {
            if (!drag || e.pointerId !== drag.pointerId) return;
            endDrag(false);
          }

          function onDragKey(e: KeyboardEvent) {
            if (e.key !== "Escape" || !drag) return;
            e.preventDefault();
            e.stopPropagation();
            endDrag(false);
          }

          /**
           * Move the node at `from` to the boundary `to`, in ONE transaction.
           *
           * Delete first, then map the insertion point through that deletion —
           * inserting first would shift `from` and delete the wrong node.
           */
          function moveBlock(from: number, to: number) {
            const { state: s } = view;
            const node = s.doc.nodeAt(from);
            if (!node) return;
            const end = from + node.nodeSize;
            // Dropping a block back onto either of its own edges is a no-op,
            // and doing it as a real move would still dirty the document and
            // wake the autosave for nothing.
            if (to >= from && to <= end) return;

            const tr = s.tr.delete(from, end);
            const at = tr.mapping.map(to);
            tr.insert(at, node);
            try {
              tr.setSelection(NodeSelection.create(tr.doc, at));
            } catch {
              /* the moved node may not be selectable; the move still stands */
            }
            view.dispatch(tr.scrollIntoView());
          }

          el.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || state.pos === null) return;
            // NOT preventDefault() on mousedown — that is what silently killed
            // the previous native-DnD implementation. preventDefault here on
            // pointerdown is safe and keeps the caret from jumping.
            e.preventDefault();
            e.stopPropagation();

            const sel = (() => {
              try {
                return NodeSelection.create(view.state.doc, state.pos!);
              } catch {
                return null;
              }
            })();
            if (sel) view.dispatch(view.state.tr.setSelection(sel));

            drag = {
              from: state.pos,
              to: null,
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              active: false,
            };
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              /* capture is an optimisation; the window listeners are the mechanism */
            }
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onDragUp);
            window.addEventListener("pointercancel", onDragCancel);
            window.addEventListener("keydown", onDragKey, true);
          });

          view.dom.addEventListener("mousemove", onMouseMove);
          view.dom.addEventListener("mouseleave", onMouseLeave);
          el.addEventListener("mouseenter", () => {
            if (!drag) el.style.display = "flex";
          });

          return {
            update: () => {
              // A doc change can move or remove the hovered block; re-anchor
              // rather than leave the grip floating over unrelated content.
              if (!drag && state.pos !== null) positionHandle(state, state.pos);
            },
            destroy: () => {
              endDrag(false);
              view.dom.removeEventListener("mousemove", onMouseMove);
              view.dom.removeEventListener("mouseleave", onMouseLeave);
              el.remove();
              indicator.remove();
            },
          };
        },
      }),
    ];
  },
});
