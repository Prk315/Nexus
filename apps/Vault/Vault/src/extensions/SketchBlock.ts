// A small drawing surface, inline in a note.
//
// **Strokes live in the note document**, as an attribute, not in a
// `vault_content` row of their own. That is a deliberate reversal of the
// pattern used by PDF annotations (`{id}_annot`) and book margins
// (`{id}_margins`), and the reasons are specific:
//
//   - `NoteEditor`'s `nodeId` is OPTIONAL. WorkbookEditor renders N note
//     editors with no node id at all, so there is no id to derive a key from
//     and a sketch drawn there would have nowhere to go.
//   - A derived key is one row per note, but a note may hold many sketches.
//     Minting a synthetic id per block re-introduces every problem the id
//     avoided: copy-paste duplicates it (two blocks editing one drawing),
//     `deleteNode`'s cleanup list can't enumerate them, and undo can't reach
//     across the two stores.
//   - In the document, all of that is free. Copy-paste clones the strokes,
//     Cmd-Z undoes a stroke, deleting the block deletes the drawing, and the
//     400 ms autosave already coalesces bursts.
//
// The cost is size, and it is bounded rather than hoped about: see
// SKETCH_MAX_CHARS in lib/sketch.ts. A sketch is meant to be a diagram beside
// a paragraph — the Canvas node kind is still the right home for a drawing
// that wants a page.
//
// ⚠️ This is a NEW NODE TYPE, so it must be deployed to web, Mac and iPad
// before any note containing one is created. A client without it shows the
// schema-guard banner (lib/noteSchemaGuard.ts) rather than blanking the note,
// which is what the guard is for — but the note is still unreadable there
// until it updates.

import { readWidthPct } from "../lib/blockSize";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SketchView } from "../components/SketchView";
import { serializeSketch, parseSketch, EMPTY_SKETCH } from "../lib/sketch";

// ── Coordinate space ────────────────────────────────────────────────────────
// Strokes are stored in a LOGICAL space 1000 units wide, not in CSS pixels,
// and `height` is in those same units — so it is really an aspect ratio.
//
// Pixels were the first thing tried and they are wrong, because the width of a
// note is no longer fixed: the per-note width setting alone spans 720 px to
// full-bleed, and the same note opens on an iPad. A sketch drawn at 1180 px
// and reopened at 720 px would have a third of itself outside the box, with
// nothing to suggest the drawing was ever wider. In logical units the SVG
// viewBox does the scaling and the drawing simply gets bigger or smaller,
// which is what anyone expects of a diagram.
export const SKETCH_UNITS = 1000;
export const SKETCH_DEFAULT_HEIGHT = 330;
export const SKETCH_MIN_HEIGHT = 140;
export const SKETCH_MAX_HEIGHT = 1400;

export type SketchBackground = "blank" | "grid" | "lines";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sketchBlock: {
      insertSketch: () => ReturnType;
    };
  }
}

export const SketchBlock = Node.create({
  name: "sketchBlock",
  group: "block",
  // An atom with no editable content: ProseMirror must never try to place a
  // caret inside the canvas, and the node view owns every pointer event that
  // lands on it.
  atom: true,
  // NOT `draggable`. That flag makes ProseMirror set `dom.draggable = true`,
  // and a native HTML5 drag starting mid-stroke is exactly the collision
  // BlockHandle.ts documents from the other side: preventing the default on
  // pointerdown (which drawing must do) is what cancels a native drag, so the
  // two can only ever half-work. The gutter grip drags this block like every
  // other one — it is pointer-driven and needs no help from the spec.
  draggable: false,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      // Stored as a JSON STRING rather than a nested object. ProseMirror is
      // happy with either, but an attribute that round-trips through an HTML
      // data-attribute has to be a string on the way out anyway, and having
      // one representation instead of two removes a whole class of "works in
      // JSON, silently empty after a paste" bug.
      data: {
        default: serializeSketch(EMPTY_SKETCH),
        parseHTML: (el) => el.getAttribute("data-sketch") ?? serializeSketch(EMPTY_SKETCH),
        renderHTML: (attrs) => ({ "data-sketch": attrs.data }),
      },
      height: {
        default: SKETCH_DEFAULT_HEIGHT,
        parseHTML: (el) => {
          const n = Number(el.getAttribute("data-height"));
          return Number.isFinite(n) && n > 0
            ? Math.min(Math.max(n, SKETCH_MIN_HEIGHT), SKETCH_MAX_HEIGHT)
            : SKETCH_DEFAULT_HEIGHT;
        },
        renderHTML: (attrs) => ({ "data-height": String(attrs.height) }),
      },
      /**
       * Width as a PERCENTAGE of the note column, or null for the full width.
       *
       * ⚠️ Percent, not pixels — the same reason note width is a keyword and
       * column widths are weights. A sketch drawn on a wide screen and opened
       * on the iPad must occupy the same share of the column, not the same
       * number of pixels.
       *
       * ⚠️ null, not 100. "Never sized" and "deliberately full width" are the
       * same picture but not the same document, and the double-click reset has
       * to be able to reach the first.
       */
      width: {
        default: null as number | null,
        parseHTML: (el) => readWidthPct(el.getAttribute("data-width")),
        renderHTML: (attrs) =>
          attrs.width == null ? {} : { "data-width": String(attrs.width) },
      },
      background: {
        default: "blank" as SketchBackground,
        parseHTML: (el) => el.getAttribute("data-bg") ?? "blank",
        renderHTML: (attrs) => ({ "data-bg": attrs.background }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sketch"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    // No children: everything about the drawing is in the attributes, so the
    // serialized form is self-contained and a paste into another note carries
    // the whole sketch.
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sketch", class: "sketch-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SketchView);
  },

  addCommands() {
    return {
      insertSketch:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { data: serializeSketch(EMPTY_SKETCH), height: SKETCH_DEFAULT_HEIGHT, background: "blank" },
          }),
    };
  },
});

/** Re-exported so call sites don't need to know where the parser lives. */
export { parseSketch, serializeSketch };
