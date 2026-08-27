// A live view onto PathFinder's tasks, embedded in a note.
//
// ── Why ONE node type and three views, not three node types ──────────────────
//
// The slash menu offers three blocks — To-do list, Board, Table — and they look
// and behave nothing like each other. In the document they are all
// `pathfinderBlock`, distinguished by a `view` attribute.
//
// That is not tidiness, it is the data-loss rule. An unknown NODE TYPE does not
// degrade: `createNodeFromContent` catches ProseMirror's "Unknown node type",
// returns an EMPTY DOCUMENT, and the 400 ms autosave writes that blank over the
// real note — `vault_content` keeps no history (see lib/noteSchemaGuard.ts).
// Vault's three clients (Vercel web, the Tauri Mac app, and the iPad build,
// which only refreshes when someone runs `npm run ios:vault`) update
// independently, so every new node type is a live race until the slowest client
// catches up. An unknown ATTRIBUTE is the opposite: `Node.fromJSON` iterates the
// *type's* declared attributes and never looks for extras, so it is dropped in
// silence and the note is fine.
//
// Three node types would mean three separate deploy-everywhere gates and three
// chances to blank a note. One node type means one gate — and a fourth view
// (timeline, calendar, gallery) then costs nothing at all. It also makes
// switching an existing block between the three views a one-attribute edit,
// which is the feature people actually want once they have used it twice.
//
// ⚠️ It is still a NEW NODE TYPE. Deploy web, Mac and iPad before creating any
// note that contains one. A client without it shows the schema-guard banner
// rather than blanking the note, but the note is unreadable there until it
// updates.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
// Deliberately the LAZY wrapper, not the view itself — see
// components/PathfinderBlockLazy.tsx. Importing the view here would drag the
// Supabase client into the schema, and `noteSchemaGuard` builds the schema
// before any editor (or any network client) exists.
import { PathfinderBlockLazy } from "../components/PathfinderBlockLazy";
import {
  defaultSpec,
  serializeSpec,
  PF_VIEWS,
  type PfBlockView,
} from "../lib/pathfinderBlock";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pathfinderBlock: {
      insertPathfinderBlock: (view: PfBlockView) => ReturnType;
    };
  }
}

export const PathfinderBlock = Node.create({
  name: "pathfinderBlock",
  group: "block",
  // An atom with no editable content. The block is a control surface — inputs,
  // checkboxes, drag handles — and ProseMirror must never try to place a caret
  // inside it or treat a click on a checkbox as a selection change.
  atom: true,
  // NOT `draggable`, for the same reason SketchBlock isn't: that flag sets
  // `dom.draggable = true` and a native HTML5 drag starting on a Kanban card is
  // exactly the collision BlockHandle.ts documents — preventing the default on
  // pointerdown (which card dragging must do) is what cancels a native drag, so
  // the two can only ever half-work. The gutter grip drags this block like any
  // other; card drags inside it are pointer-driven and need no help from the spec.
  draggable: false,
  selectable: true,
  // The block owns its whole rectangle. Without this, Backspace at the start of
  // the following paragraph joins into it and ProseMirror starts trying to merge
  // content across a node that has none.
  isolating: true,

  addAttributes() {
    return {
      view: {
        default: "list" as PfBlockView,
        parseHTML: (el) => {
          const v = el.getAttribute("data-view");
          return PF_VIEWS.includes(v as PfBlockView) ? v : "list";
        },
        renderHTML: (attrs) => ({ "data-view": attrs.view }),
      },
      // The filter/sort/display configuration, as a JSON string. See
      // lib/pathfinderBlock.ts for why a string rather than a nested object,
      // and for the parser that validates every field independently.
      spec: {
        default: serializeSpec(defaultSpec("list")),
        parseHTML: (el) => el.getAttribute("data-spec") ?? serializeSpec(defaultSpec("list")),
        renderHTML: (attrs) => ({ "data-spec": attrs.spec }),
      },
      // User-set heading. Empty string means "derive it from the filter", which
      // is what keeps an unnamed block's label correct after a plan is renamed.
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pathfinder"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    // No children: the block renders live data, so the serialized form carries
    // the QUERY and never the rows. Pasting it into another note reproduces the
    // view, not a stale snapshot of last week's tasks — which is the whole
    // difference between this and the existing "Insert from Database" action.
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "pathfinder", class: "pf-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PathfinderBlockLazy);
  },

  addCommands() {
    return {
      insertPathfinderBlock:
        (view: PfBlockView) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { view, spec: serializeSpec(defaultSpec(view)), title: "" },
          }),
    };
  },
});
