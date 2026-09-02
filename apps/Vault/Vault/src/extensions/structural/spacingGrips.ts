// Drag-to-adjust inner and outer spacing on a container, callout or toggle.
//
// The same two decisions that carry `columnResize.ts`, for the same reasons:
//
// 1. The grips are widget DECORATIONS, not a React node view. Giving the
//    container family node views would mean a React tree per block,
//    re-reconciling on every keystroke typed inside it, to render two handles
//    that never change.
//
// 2. The drag DISPATCHES NOTHING. Spacing is written to the DOM while the
//    pointer moves and exactly one transaction is committed on pointerup. A
//    transaction per pointermove is ~60 document rewrites a second, each waking
//    the 400 ms autosave — the shape of the 2026-08-15 incident, and 200
//    intermediate values in the undo history.
//
// ── ⚠️ Only on the block the caret is in ───────────────────────────────────
//
// Decorating every container in the note would put two handles on every card on
// the page, which is visual noise in a document you are trying to read, and
// makes an accidental drag likely. The caret already says which block you mean.

import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { spacingStep, spacingPx, readSpacing, type SpacingStep } from "../../lib/blockSize";

export const spacingGripsKey = new PluginKey("vaultSpacingGrips");

/** The container types that carry `pad`/`gap`. Columns are absent on purpose:
 *  a row's spacing is its children's, and two controls for one gap is one too
 *  many. */
const SPACED = ["containerBlock", "calloutBlock", "toggleBlock"];

type Kind = "pad" | "gap";

interface DragState {
  view: EditorView;
  pos: number;
  dom: HTMLElement;
  kind: Kind;
  startY: number;
  startPx: number;
  pointerId: number;
  grip: HTMLElement;
}

let drag: DragState | null = null;

function write(dom: HTMLElement, kind: Kind, px: number) {
  if (kind === "pad") dom.style.paddingBlock = `${px}px`;
  else dom.style.marginBlock = `${px}px`;
}

function onMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  write(drag.dom, drag.kind, spacingPx(spacingStep(drag.startPx + (e.clientY - drag.startY))));
}

function commit(step: SpacingStep) {
  if (!drag) return;
  const { view, pos, kind } = drag;
  const node = view.state.doc.nodeAt(pos);
  // The document can have changed under a drag — a collaborator's edit, an
  // autosave-triggered reload. Writing to a position that is no longer this
  // node would silently set spacing on something else.
  if (!node || !SPACED.includes(node.type.name)) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [kind]: step }));
}

function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  const step = spacingStep(d.startPx + (e.clientY - d.startY));
  drag = null;
  try { d.grip.releasePointerCapture(d.pointerId); } catch { /* already gone */ }
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  // Restore the inline style to nothing: the committed attribute renders it
  // through renderHTML, and leaving both would make a later "reset" look
  // like it did nothing.
  d.dom.style.paddingBlock = "";
  d.dom.style.marginBlock = "";
  drag = d;
  commit(step);
  drag = null;
}

function makeGrip(view: EditorView, pos: number, kind: Kind, current: SpacingStep): HTMLElement {
  const grip = document.createElement("span");
  grip.className = `nx-grip nx-grip-${kind === "pad" ? "padding" : "margin"}`;
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", kind === "pad" ? "Inner spacing" : "Outer spacing");
  grip.title = `${kind === "pad" ? "Inner" : "Outer"} spacing — drag; double-click to reset`;

  grip.addEventListener("pointerdown", (e) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    drag = {
      view, pos, dom, kind,
      startY: e.clientY,
      startPx: spacingPx(current),
      pointerId: e.pointerId,
      grip,
    };
    // ⚠️ Window listeners as well as capture: a drag that leaves the grip —
    // which every one of these does — otherwise stops updating, and the block
    // freezes mid-drag with no pointerup to commit it.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  grip.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    // ⚠️ null, not 0. Zero is "no spacing", which is a choice; null is
    // "never set", which follows the stylesheet. Reset must reach the second.
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [kind]: null }));
  });

  return grip;
}

/**
 * ⚠️ Built straight from state, with the view arriving through the widget's own
 * `toDOM` callback.
 *
 * The first version kept the set in plugin state and dispatched a transaction
 * from `view.update` to refresh it. A dispatch inside an update is a loop
 * waiting for one guard to be wrong — and there is no need for it, because
 * `decorations(state)` is called with everything this needs and `toDOM` is
 * handed the view.
 */
function build(state: EditorState): DecorationSet {
  const { $from } = state.selection;

  // The innermost spaced ancestor of the caret, and only that one.
  let found: number | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if (SPACED.includes($from.node(d).type.name)) { found = $from.before(d); break; }
  }
  if (found === null) return DecorationSet.empty;

  const pos = found;
  const node = state.doc.nodeAt(pos);
  if (!node) return DecorationSet.empty;

  const pad = readSpacing(node.attrs.pad) ?? 0;
  const gap = readSpacing(node.attrs.gap) ?? 0;

  return DecorationSet.create(state.doc, [
    Decoration.widget(pos + 1, (view) => makeGrip(view, pos, "pad", pad),
      { side: -1, key: `pad:${pos}:${pad}` }),
    Decoration.widget(pos + 1, (view) => makeGrip(view, pos, "gap", gap),
      { side: -1, key: `gap:${pos}:${gap}` }),
  ]);
}

export function spacingGripsPlugin() {
  return new Plugin({
    key: spacingGripsKey,
    props: {
      decorations(state) {
        return build(state);
      },
    },
  });
}
