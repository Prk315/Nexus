// Drag-to-resize gutters between columns.
//
// Two decisions carry this file:
//
// 1. The gutters are widget DECORATIONS, not a React node view on the row. A
//    node view would mean a React tree per row, re-reconciling on every
//    keystroke typed inside it, to render N−1 divs that never change. This is
//    the shape prosemirror-tables uses for its own column resizing.
//
// 2. The drag DISPATCHES NOTHING. Widths are written straight to the DOM's
//    flexGrow while the pointer moves, and exactly one transaction is
//    dispatched on pointerup. A transaction per pointermove would be ~60
//    document rewrites a second, each waking the 400ms autosave and pushing a
//    full note body at Supabase — the same shape of mistake that wedged the
//    database on 2026-08-15. It also keeps 200 intermediate widths out of the
//    undo history.

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { COLUMN_BLOCK, DEFAULT_COLUMN_GROW } from "./Columns";

export const columnResizeKey = new PluginKey<DecorationSet>("vaultColumnResize");

/** A column narrower than this is unusable, so the drag clamps here. */
export const MIN_COLUMN_PX = 60;

interface DragState {
  view: EditorView;
  leftPos: number;
  rightPos: number;
  leftDom: HTMLElement;
  rightDom: HTMLElement;
  startX: number;
  startLeftPx: number;
  startRightPx: number;
  /** Sum of the pair's grow values, held constant so other columns don't move. */
  growSum: number;
  pointerId: number;
  gutter: HTMLElement;
}

let drag: DragState | null = null;

function growOf(view: EditorView, pos: number): number {
  const w = view.state.doc.nodeAt(pos)?.attrs?.width;
  return typeof w === "number" && w > 0 ? w : DEFAULT_COLUMN_GROW;
}

/**
 * Given the position of a gutter widget, the two columns it sits between.
 * Resolved fresh at pointerdown rather than captured when the decoration was
 * built, so an edit elsewhere in the document can't hand the drag stale
 * positions.
 */
function neighbours(view: EditorView, widgetPos: number) {
  const $pos = view.state.doc.resolve(widgetPos);
  const row = $pos.parent;
  if (row.type.name !== COLUMN_BLOCK) return null;

  const index = $pos.index();
  if (index < 1 || index >= row.childCount) return null;

  let leftPos = $pos.start();
  for (let i = 0; i < index - 1; i++) leftPos += row.child(i).nodeSize;
  const rightPos = leftPos + row.child(index - 1).nodeSize;
  return { leftPos, rightPos };
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;

  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  d.gutter.classList.remove("is-dragging");
  document.body.classList.remove("vault-col-resizing");
  try {
    d.gutter.releasePointerCapture(d.pointerId);
  } catch {
    /* the pointer may already be gone */
  }
  return d;
}

function onPointerMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();

  const total = drag.startLeftPx + drag.startRightPx;
  if (total <= MIN_COLUMN_PX * 2) return;

  const dx = e.clientX - drag.startX;
  const leftPx = Math.min(Math.max(drag.startLeftPx + dx, MIN_COLUMN_PX), total - MIN_COLUMN_PX);
  const rightPx = total - leftPx;

  // Straight to the DOM. No transaction, no React render, no autosave.
  drag.leftDom.style.flexGrow = String((leftPx / total) * drag.growSum);
  drag.rightDom.style.flexGrow = String((rightPx / total) * drag.growSum);
}

function onPointerUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = endDrag();
  if (!d) return;

  // The drag listens on `window`, so a note closed mid-drag leaves this
  // handler holding a torn-down view. Dispatching into one throws.
  if (d.view.isDestroyed) return;

  const leftGrow = parseFloat(d.leftDom.style.flexGrow);
  const rightGrow = parseFloat(d.rightDom.style.flexGrow);
  if (!Number.isFinite(leftGrow) || !Number.isFinite(rightGrow)) return;

  const round = (n: number) => Math.round(n * 1000) / 1000;

  // One transaction for the whole gesture. addToHistory stays true — unlike a
  // toggle collapse, a resize IS an edit and should undo in a single step.
  const tr = d.view.state.tr;
  tr.setNodeAttribute(d.leftPos, "width", round(leftGrow));
  tr.setNodeAttribute(d.rightPos, "width", round(rightGrow));
  d.view.dispatch(tr);
}

function startDrag(
  view: EditorView,
  gutter: HTMLElement,
  e: PointerEvent,
  getPos: () => number | undefined
) {
  if (drag) return;
  // getPos returns undefined once the widget has been removed from the doc —
  // a pointerdown can still arrive on a DOM node mid-teardown.
  const pos = getPos();
  if (pos === undefined) return;
  const pair = neighbours(view, pos);
  if (!pair) return;

  const leftDom = view.nodeDOM(pair.leftPos) as HTMLElement | null;
  const rightDom = view.nodeDOM(pair.rightPos) as HTMLElement | null;
  if (!leftDom || !rightDom) return;

  e.preventDefault();
  e.stopPropagation();

  drag = {
    view,
    leftPos: pair.leftPos,
    rightPos: pair.rightPos,
    leftDom,
    rightDom,
    startX: e.clientX,
    startLeftPx: leftDom.getBoundingClientRect().width,
    startRightPx: rightDom.getBoundingClientRect().width,
    growSum: growOf(view, pair.leftPos) + growOf(view, pair.rightPos),
    pointerId: e.pointerId,
    gutter,
  };

  gutter.classList.add("is-dragging");
  document.body.classList.add("vault-col-resizing");
  try {
    gutter.setPointerCapture(e.pointerId);
  } catch {
    /* capture is an optimisation; the window listeners are the mechanism */
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

export function buildColumnDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== COLUMN_BLOCK) return true;

    let offset = pos + 1;
    for (let i = 0; i < node.childCount; i++) {
      if (i > 0) {
        decorations.push(
          Decoration.widget(
            offset,
            // ProseMirror hands the widget the live view and a getPos that is
            // already mapped through any intervening steps — which is why the
            // drag never needs to capture a position at build time.
            (view, getPos) => {
              const el = document.createElement("div");
              el.className = "column-gutter";
              el.setAttribute("contenteditable", "false");
              el.addEventListener("pointerdown", (ev) =>
                startDrag(view, el, ev as PointerEvent, getPos)
              );
              return el;
            },
            // side:-1 keeps the widget out of the column that follows it;
            // ignoreSelection stops the caret ever landing on the gutter.
            { side: -1, ignoreSelection: true, key: `col-gutter-${pos}-${i}` }
          )
        );
      }
      offset += node.child(i).nodeSize;
    }
    return false; // a row can't contain another row
  });

  return DecorationSet.create(doc, decorations);
}

export function columnResizePlugin() {
  return new Plugin<DecorationSet>({
    key: columnResizeKey,
    state: {
      init: (_, state) => buildColumnDecorations(state.doc),
      // Rebuilt rather than mapped: the gutters are purely positional, so
      // there is no per-decoration state worth preserving across an edit.
      apply: (tr, old) => (tr.docChanged ? buildColumnDecorations(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return columnResizeKey.getState(state);
      },
    },
  });
}
