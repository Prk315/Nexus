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
import { Plugin, PluginKey, NodeSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";

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
  /** True while the pointer is actively over the editor's hover band. */
  hovering: boolean;
}

interface DragState {
  /** Position of the block being moved, in the doc as it was at pointerdown. */
  from: number;
  /** Where it would land: position of a sibling boundary. */
  to: number | null;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

interface BlockHandlePluginState {
  /** Positions of blocks toggled into a Cmd+Shift multi-selection. */
  selected: number[];
}

function isBlockGroupNode(node: PMNode): boolean {
  const group = node.type.spec.group;
  return !!group && group.split(" ").includes("block");
}

/**
 * The innermost group:"block" ancestor of a resolved position.
 *
 * Walking from the deepest depth outward — rather than jumping straight to
 * depth 1 — is what makes a paragraph inside a column inside a toggle its own
 * addressable block instead of always resolving to the outermost container.
 * Non-block wrappers (`column`, `toggleSummary`, `toggleContent` — see
 * Columns.ts/Toggle.ts) are deliberately not in group "block", so the walk
 * passes over them and lands on the nearest real block: the toggle itself
 * when hovering its summary line (the summary can't be moved on its own), or
 * the specific paragraph when hovering content nested several levels deep.
 */
function nearestBlock($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (isBlockGroupNode(node)) return { pos: $pos.before(d), node };
  }
  return null;
}

function blockAt(view: EditorView, x: number, y: number): { pos: number; node: PMNode } | null {
  const found = view.posAtCoords({ left: x, top: y });
  if (!found) return null;
  const $pos = view.state.doc.resolve(Math.min(found.pos, view.state.doc.content.size));
  if ($pos.depth === 0) return null;
  return nearestBlock($pos);
}

/** The block the caret/selection is currently inside, at any depth. */
function blockAtSelection(view: EditorView): { pos: number; node: PMNode } | null {
  const $head = view.state.doc.resolve(view.state.selection.head);
  if ($head.depth === 0) return null;
  return nearestBlock($head);
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
      new Plugin<BlockHandlePluginState>({
        key: blockHandleKey,

        state: {
          init: () => ({ selected: [] }),
          apply(tr: Transaction, value: BlockHandlePluginState) {
            let selected = value.selected.map((p) => tr.mapping.map(p));
            const meta = tr.getMeta(blockHandleKey) as { toggleSelect?: number } | undefined;
            if (meta && typeof meta.toggleSelect === "number") {
              const p = meta.toggleSelect;
              selected = selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p];
            } else if (tr.selectionSet) {
              // Any other explicit selection change (a plain click, typing,
              // arrow-key navigation) abandons a stale multi-selection —
              // matching how every other multi-select UI treats a plain click.
              selected = [];
            }
            return { selected };
          },
        },

        props: {
          decorations(state) {
            const pluginState = blockHandleKey.getState(state) as BlockHandlePluginState | undefined;
            const selected = pluginState?.selected ?? [];
            if (!selected.length) return null;
            const decos: Decoration[] = [];
            for (const pos of selected) {
              const node = state.doc.nodeAt(pos);
              if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "block-multi-selected" }));
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },

        view(view) {
          const el = document.createElement("div");
          el.className = "block-handle";
          el.setAttribute("contenteditable", "false");
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", "Drag block");
          el.title = "Drag to move · ⌘⇧-click to multi-select";
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

          const state: HandleState = { el, indicator, view, pos: null, lastProbe: 0, hovering: false };
          let drag: DragState | null = null;
          /** The block DOM currently muted by a handle press; cleared on release. */
          let grabbedEl: HTMLElement | null = null;

          // ── Follow: keep the handle next to whatever block is "live" ────────
          // Hovering wins while the pointer is actually moving over the editor;
          // once it leaves (or never entered — keyboard navigation, a paste,
          // typing after a click elsewhere), the handle tracks the selection
          // instead, so a block being edited always has a reachable handle no
          // matter how deep it is nested.
          function followSelection() {
            if (drag || state.hovering) return;
            const hit = blockAtSelection(view);
            if (hit) positionHandle(state, hit.pos);
            else {
              el.style.display = "none";
              state.pos = null;
            }
          }

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
            state.hovering = true;
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
            state.hovering = false;
            followSelection();
          }

          // ── Drop target ────────────────────────────────────────────────────
          /**
           * Nearest sibling boundary to `clientY`: before the hovered block
           * if the pointer is in its upper half, after it otherwise. The
           * boundary is at whatever depth the hovered block itself sits at —
           * siblings within the same column, callout or top-level document.
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
            let top: number;
            let left = editorRect.left;
            let width = editorRect.width;

            // A boundary sits between two siblings, resolved via ProseMirror's
            // own nodeBefore/nodeAfter rather than doc.child(index(0)) — that
            // hardcoded top-level children, which is exactly what stopped this
            // working for a boundary inside a column or a callout.
            const clamped = Math.max(0, Math.min(at, doc.content.size));
            const $at = doc.resolve(clamped);
            const nodeBefore = $at.nodeBefore;
            const nodeAfter = $at.nodeAfter;

            let anchorDom: HTMLElement | null = null;
            let anchorTop: "top" | "bottom" = "top";
            if (nodeBefore) {
              anchorDom = view.nodeDOM(Math.max(0, clamped - nodeBefore.nodeSize)) as HTMLElement | null;
              anchorTop = "bottom";
            } else if (nodeAfter) {
              anchorDom = view.nodeDOM(clamped) as HTMLElement | null;
              anchorTop = "top";
            }

            if (anchorDom && anchorDom.nodeType === 1) {
              const r = anchorDom.getBoundingClientRect();
              top = anchorTop === "bottom" ? r.bottom : r.top;
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
            grabbedEl?.classList.remove("is-grabbed");
            grabbedEl = null;
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
            try {
              // A drop target resolved at any depth may land somewhere the
              // moved node's schema doesn't allow (e.g. dragging into a
              // structural boundary that isn't plain block+ content) — fail
              // quietly rather than let ProseMirror throw mid-drag.
              tr.insert(at, node);
            } catch {
              return;
            }
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

            if (e.metaKey && e.shiftKey) {
              // Toggle membership only — no NodeSelection, no drag. A held
              // Cmd+Shift click is purely "add/remove this block from my
              // multi-selection", independent of the single-select gesture
              // below, which stays exactly as it was.
              view.dispatch(view.state.tr.setMeta(blockHandleKey, { toggleSelect: state.pos }));
              return;
            }

            const sel = (() => {
              try {
                return NodeSelection.create(view.state.doc, state.pos!);
              } catch {
                return null;
              }
            })();
            if (sel) view.dispatch(view.state.tr.setSelection(sel));

            // Immediate feedback that this block has been grabbed, before the
            // drag threshold is even crossed — the mute is the confirmation
            // that the press registered, not a signal that a move happened.
            const dom = view.nodeDOM(state.pos) as HTMLElement | null;
            if (dom && dom.nodeType === 1) {
              dom.classList.add("is-grabbed");
              grabbedEl = dom;
            }

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
            if (drag) return;
            state.hovering = true;
            el.style.display = "flex";
          });

          return {
            update: () => {
              // A doc change can move or remove the hovered block; re-anchor
              // rather than leave the grip floating over unrelated content.
              if (drag) return;
              if (state.hovering) {
                if (state.pos !== null) positionHandle(state, state.pos);
                return;
              }
              followSelection();
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
