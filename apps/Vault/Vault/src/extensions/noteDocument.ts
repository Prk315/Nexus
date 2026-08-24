// The note's own document node, carrying per-note settings.
//
// Width lives here rather than in localStorage because it is a property of the
// NOTE, not of this browser: a note laid out as three columns should be wide
// on the iPad too. A doc attribute travels with the content for free.
//
// Safe for older clients. ProseMirror's `Node.fromJSON` builds attributes by
// iterating the *type's* declared attrs, so a key the type doesn't know is
// simply ignored rather than throwing — a build without this attribute reads
// the note fine and renders it at the default measure. That is a weaker
// failure than an unknown NODE type (which blanks the document — see
// lib/noteSchemaGuard.ts), and it is why width could be added without waiting
// for every client to update. There is a test pinning exactly that.

import Document from "@tiptap/extension-document";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const noteWidthKey = new PluginKey("vaultNoteWidth");

export const NOTE_WIDTHS = ["auto", "wide", "full"] as const;
export type NoteWidth = (typeof NOTE_WIDTHS)[number];

export const NOTE_WIDTH_LABELS: Record<NoteWidth, string> = {
  // "auto" keeps the pre-existing behaviour: a reading measure, widened by CSS
  // when the note actually contains a column row.
  auto: "Reading width",
  wide: "Wide",
  full: "Full width",
};

export const DEFAULT_NOTE_WIDTH: NoteWidth = "auto";

export const NoteDocument = Document.extend({
  addAttributes() {
    return {
      width: {
        default: DEFAULT_NOTE_WIDTH,
        parseHTML: (el) => {
          const v = el.getAttribute("data-note-width");
          return (NOTE_WIDTHS as readonly string[]).includes(v ?? "") ? v : DEFAULT_NOTE_WIDTH;
        },
        renderHTML: (attrs) =>
          attrs.width && attrs.width !== DEFAULT_NOTE_WIDTH
            ? { "data-note-width": attrs.width }
            : {},
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: noteWidthKey,
        props: {
          // ProseMirror never renders the TOP node — `view.dom` is the editable
          // element it created, and the doc's renderHTML is only consulted for
          // serialization. So a doc attribute reaches CSS only if something
          // projects it onto the editable, which is what this does. Without
          // it the `.ProseMirror[data-note-width]` selectors match nothing and
          // the setting appears to do nothing at all.
          attributes: (state): Record<string, string> => {
            const w = state.doc.attrs?.width;
            return w && w !== DEFAULT_NOTE_WIDTH ? { "data-note-width": String(w) } : {};
          },
        },
      }),
    ];
  },
});
