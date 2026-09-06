// A runnable code cell, inline in a note — the notebook surface.
//
// The model is CanvasEditor's `code_cell` block, which has worked this way for
// a long time: one namespace per document, Shift+Enter to run, results
// rendered under the source. What is new here is the note as a host, and
// Pyodide as the Python runtime so cells run on the web build rather than only
// in the Tauri desktop app.
//
// ⚠️ Code and outputs live in the DOCUMENT, as attributes — the same decision
// SketchBlock.ts makes for strokes and for the same reasons: `NoteEditor`'s
// `nodeId` is optional (WorkbookEditor mounts editors with none), one note may
// hold many cells, and in the document copy-paste, undo and delete all behave
// without a second store to keep in step. The cost is size, and it is bounded
// rather than hoped about — see CELL_OUTPUT_MAX_CHARS in kernel/outputs.ts.
//
// ⚠️ This is a NEW NODE TYPE. A client that does not have it shows the
// schema-guard banner (lib/noteSchemaGuard.ts) rather than blanking the note,
// but the note is unreadable there until it updates. Vault currently ships to
// Vercel web only, so that is one atomic deploy; if a Mac or iPad build is ever
// installed again, this has to reach it before any note containing a cell is
// created.
//
// ⚠️ Execution is Python and SQL, never JavaScript, and that is a security
// decision rather than a scoping one. See kernel/pyodide.worker.ts: the worker
// is what keeps document-driven code away from the page's Supabase session, and
// a JS cell would run same-origin with no such boundary. `lib/formula.ts`
// states the rule this feature had to answer.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeCellView } from "../components/CodeCellView";
import type { CellLanguage, OutputChunk } from "../kernel/types";

export const CODE_CELL_LANGUAGES: Array<{ value: CellLanguage; label: string }> = [
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
];

function parseOutputs(raw: string | null): OutputChunk[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Outputs are stored content and can arrive truncated or hand-edited. An
    // unreadable result must degrade to "no result", never to a throw during
    // parseHTML — that runs while the document is being built, where an
    // exception blanks the note rather than the cell.
    return [];
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    codeCell: {
      insertCodeCell: (language?: CellLanguage) => ReturnType;
    };
  }
}

export const CodeCellBlock = Node.create({
  name: "codeCell",
  group: "block",
  // An atom: ProseMirror must never place a caret inside the cell. The source
  // is edited by a textarea the node view owns, so that the editor's own
  // keymaps (Enter splitting a paragraph, Backspace joining blocks) cannot
  // reach code being typed.
  atom: true,
  draggable: false,
  selectable: true,
  // Same reason as the structural family: without it, joinBackward merges a
  // neighbouring paragraph into the cell across a boundary the schema means to
  // hold.
  isolating: true,

  addOptions() {
    return {
      /**
       * The kernel namespace these cells share.
       *
       * Every cell in one note runs in one session, which is what makes it a
       * notebook rather than a page of unrelated snippets: `x = 1` in the first
       * cell is visible in the second. NoteEditor supplies the note's id, or a
       * per-mount id when it has none (WorkbookEditor renders editors without
       * one), so two notes never share a namespace by accident.
       *
       * An option, not a schema attribute — it describes where the cell is
       * being rendered, not what the document contains, and putting it in the
       * document would mean a pasted cell dragged another note's namespace
       * along with it.
       */
      sessionId: "vault-note" as string,
    };
  },

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-code") ?? "",
        renderHTML: (attrs) => ({ "data-code": attrs.code }),
      },
      language: {
        default: "python" as CellLanguage,
        parseHTML: (el) => (el.getAttribute("data-language") === "sql" ? "sql" : "python"),
        renderHTML: (attrs) => ({ "data-language": attrs.language }),
      },
      /**
       * Results, JSON-encoded.
       *
       * A string rather than a nested array for the same reason SketchBlock
       * stores its strokes as one: an attribute that must survive an HTML
       * data-attribute has to be a string on the way out anyway, and one
       * representation instead of two removes the "fine in JSON, empty after a
       * paste" class of bug.
       */
      outputs: {
        default: [] as OutputChunk[],
        parseHTML: (el) => parseOutputs(el.getAttribute("data-outputs")),
        renderHTML: (attrs) =>
          attrs.outputs && attrs.outputs.length > 0
            ? { "data-outputs": JSON.stringify(attrs.outputs) }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="code-cell"]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "code-cell", class: "code-cell-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeCellView);
  },

  addCommands() {
    return {
      insertCodeCell:
        (language: CellLanguage = "python") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: "", language, outputs: [] },
          }),
    };
  },
});
