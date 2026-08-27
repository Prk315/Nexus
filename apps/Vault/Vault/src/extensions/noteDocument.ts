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

// ── Text size ───────────────────────────────────────────────────────────────
// Same reasoning as width, and for the same reason it is a doc attribute rather
// than a localStorage preference: a dense reference note wants small text and a
// journal page wants large, and that is a property of the NOTE. A per-browser
// setting would also be per-browser wrong — the iPad is where you most want
// bigger text, and it is the device least likely to have set it.

export const NOTE_TEXT_SIZES = ["small", "normal", "large", "xlarge"] as const;
export type NoteTextSize = (typeof NOTE_TEXT_SIZES)[number];

export const NOTE_TEXT_LABELS: Record<NoteTextSize, string> = {
  small: "Small text",
  normal: "Normal text",
  large: "Large text",
  xlarge: "Extra large text",
};

export const DEFAULT_NOTE_TEXT: NoteTextSize = "normal";

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
      textSize: {
        default: DEFAULT_NOTE_TEXT,
        parseHTML: (el) => {
          const v = el.getAttribute("data-note-text");
          return (NOTE_TEXT_SIZES as readonly string[]).includes(v ?? "") ? v : DEFAULT_NOTE_TEXT;
        },
        // The default is not serialised, so a note that never changed it round
        // trips byte-identically and does not grow an attribute for a setting
        // nobody chose.
        renderHTML: (attrs) =>
          attrs.textSize && attrs.textSize !== DEFAULT_NOTE_TEXT
            ? { "data-note-text": attrs.textSize }
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
            const out: Record<string, string> = {};
            const w = state.doc.attrs?.width;
            if (w && w !== DEFAULT_NOTE_WIDTH) out["data-note-width"] = String(w);
            const t = state.doc.attrs?.textSize;
            if (t && t !== DEFAULT_NOTE_TEXT) out["data-note-text"] = String(t);
            return out;
          },
        },
      }),
    ];
  },
});
