// One list of editor actions, consumed by every surface that offers them.
//
// Before this, the slash menu (extensions/SlashCommands.ts) and the toolbar
// (components/NoteEditor.tsx) were two hand-maintained lists of the same
// commands, and they had already drifted — the toolbar had highlight, undo and
// redo the slash menu didn't; the slash menu's items carried icons the toolbar
// spelled differently. With a dozen structural block types arriving, that
// duplication stops being untidy and starts being the reason a new block shows
// up in one place and not the other.
//
// An action declares WHERE it appears (`surfaces`) rather than each surface
// declaring what it contains. Adding a block type is then one entry here.

import type { Editor, Range } from "@tiptap/core";
import type { ChainedCommands } from "@tiptap/core";
import type { HighlighterCategory } from "../types";
import { CALLOUT_VARIANTS, CALLOUT_LABELS, CALLOUT_ICONS } from "./structural/Callout";
import { CONTAINER_STYLES, CONTAINER_LABELS } from "./structural/Container";
import { unwrapNearestContainer } from "./structural/containerCommands";
import { insertToggle } from "./structural/toggleCommands";
import { insertColumns, addColumn, deleteColumn } from "./structural/columnCommands";

/** Every node in the structural family that "remove surrounding box" applies to. */
export const STRUCTURAL_CONTAINERS = ["calloutBlock", "containerBlock"] as const;

export type BlockSurface = "slash" | "toolbar" | "bubble";

export type BlockGroup =
  | "format"     // inline marks
  | "text"       // paragraph / headings
  | "lists"
  | "structure"  // quote, code, divider
  | "callout"    // admonition boxes
  | "container"  // generic grouping panels
  | "math"
  | "table"
  | "vault"      // highlighters, database records
  | "history";

export interface BlockActionContext {
  /** The `/query` range to delete first. Present only from the slash menu. */
  range?: Range;
}

export interface BlockAction {
  /** Stable across renames — used as a React key and a future settings key. */
  id: string;
  /** Menu label. */
  title: string;
  /** Menu glyph. */
  icon: string;
  /** Toolbar label when a full title is too wide (e.g. "B" for Bold). */
  short?: string;
  group: BlockGroup;
  /** Extra terms the slash menu should match ("todo" → Task List). */
  keywords?: string[];
  surfaces: BlockSurface[];
  run: (editor: Editor, ctx?: BlockActionContext) => void;
  isActive?: (editor: Editor) => boolean;
  /** False hides the action entirely — e.g. row/column ops outside a table. */
  isAvailable?: (editor: Editor) => boolean;
  /** Display-only hint, e.g. "⌘B". Keybindings live in the extensions. */
  shortcut?: string;
  /** Renders as a destructive/danger affordance in the toolbar. */
  danger?: boolean;
}

/**
 * Wraps a command body so the slash query is deleted in its OWN dispatch first.
 *
 * This is load-bearing, not stylistic. `insertInlineMath`/`insertBlockMath`
 * resolve their insertion point from the LIVE selection, so chaining them
 * behind `deleteRange` in a single `.run()` inserts at the stale, pre-delete
 * cursor — the node lands in the middle of the word you typed `/` after.
 * Doing it uniformly means the next person adding a selection-sensitive
 * command doesn't have to rediscover it.
 */
export function atCursor(body: (chain: ChainedCommands) => ChainedCommands): BlockAction["run"] {
  return (editor, ctx) => {
    if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
    body(editor.chain().focus()).run();
  };
}

export interface BlockRegistryOptions {
  /** Omit to leave the "Insert from Database" action out entirely. */
  onDatabaseInsert?: (editor: Editor, ctx?: BlockActionContext) => void;
  /** Insert-then-open-the-popover; NoteEditor owns the popover state. */
  onInlineMath?: (editor: Editor) => void;
  onBlockMath?: (editor: Editor) => void;
  /** Opens the link dialog for the current selection. */
  onEditLink?: (editor: Editor) => void;
  /** This note's highlighter categories; each becomes its own action. */
  highlighters?: HighlighterCategory[];
  onApplyHighlighter?: (cat: HighlighterCategory) => void;
  onEditHighlighters?: () => void;
}

const inTable = (e: Editor) => e.isActive("table");

/**
 * Built per render rather than declared as a const, because several actions
 * close over per-note state (the highlighter categories) or over callbacks
 * that only exist in some contexts (the Database picker needs an ancestor
 * Database node). Surfaces read it through a getter so the slash extension can
 * still be created exactly once.
 */
export function buildBlockRegistry(opts: BlockRegistryOptions = {}): BlockAction[] {
  const actions: BlockAction[] = [
    // ── Inline marks ────────────────────────────────────────────────────────
    {
      id: "bold", title: "Bold", icon: "B", short: "B", group: "format",
      surfaces: ["toolbar", "bubble"], shortcut: "⌘B",
      run: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive("bold"),
    },
    {
      id: "italic", title: "Italic", icon: "I", short: "I", group: "format",
      surfaces: ["toolbar", "bubble"], shortcut: "⌘I",
      run: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive("italic"),
    },
    {
      id: "underline", title: "Underline", icon: "U", short: "U", group: "format",
      surfaces: ["toolbar", "bubble"], shortcut: "⌘U",
      // StarterKit v3 ships Underline; it simply had no button until now.
      run: (e) => e.chain().focus().toggleUnderline().run(),
      isActive: (e) => e.isActive("underline"),
    },
    {
      id: "strike", title: "Strikethrough", icon: "S", short: "S", group: "format",
      surfaces: ["toolbar", "bubble"],
      run: (e) => e.chain().focus().toggleStrike().run(),
      isActive: (e) => e.isActive("strike"),
    },
    {
      id: "code", title: "Inline code", icon: "‹›", short: "‹›", group: "format",
      surfaces: ["toolbar", "bubble"], keywords: ["monospace"],
      run: (e) => e.chain().focus().toggleCode().run(),
      isActive: (e) => e.isActive("code"),
    },

    // ── Text blocks ─────────────────────────────────────────────────────────
    {
      id: "paragraph", title: "Text", icon: "¶", group: "text",
      surfaces: ["slash"], keywords: ["paragraph", "body", "plain"],
      run: atCursor((c) => c.setParagraph()),
      isActive: (e) => e.isActive("paragraph"),
    },
    ...([1, 2, 3, 4] as const).map((level): BlockAction => ({
      id: `heading${level}`,
      title: `Heading ${level}`,
      icon: `H${level}`,
      short: `H${level}`,
      group: "text",
      surfaces: level === 4 ? ["slash"] : ["slash", "toolbar"],
      keywords: ["title", "section"],
      // setHeading in the slash menu (you asked for a heading), toggleHeading
      // from the toolbar (it's a two-state button you can press again).
      run: (e, ctx) =>
        ctx?.range
          ? atCursor((c) => c.setHeading({ level }))(e, ctx)
          : e.chain().focus().toggleHeading({ level }).run(),
      isActive: (e) => e.isActive("heading", { level }),
    })),

    // ── Lists ───────────────────────────────────────────────────────────────
    {
      id: "bulletList", title: "Bullet List", icon: "•", short: "•", group: "lists",
      surfaces: ["slash", "toolbar"], keywords: ["unordered", "ul"],
      run: (e, ctx) => atCursor((c) => c.toggleBulletList())(e, ctx),
      isActive: (e) => e.isActive("bulletList"),
    },
    {
      id: "orderedList", title: "Numbered List", icon: "1.", short: "1.", group: "lists",
      surfaces: ["slash", "toolbar"], keywords: ["ordered", "ol", "numbered"],
      run: (e, ctx) => atCursor((c) => c.toggleOrderedList())(e, ctx),
      isActive: (e) => e.isActive("orderedList"),
    },
    {
      id: "taskList", title: "To-do List", icon: "☑", short: "☑", group: "lists",
      surfaces: ["slash", "toolbar"],
      keywords: ["todo", "task", "checkbox", "checklist", "check"],
      run: (e, ctx) => atCursor((c) => c.toggleTaskList())(e, ctx),
      isActive: (e) => e.isActive("taskList"),
    },

    // ── Structure ───────────────────────────────────────────────────────────
    {
      id: "blockquote", title: "Quote", icon: "❝", short: "❝", group: "structure",
      surfaces: ["slash", "toolbar"], keywords: ["citation", "blockquote"],
      run: (e, ctx) => atCursor((c) => c.toggleBlockquote())(e, ctx),
      isActive: (e) => e.isActive("blockquote"),
    },
    {
      id: "codeBlock", title: "Code Block", icon: "<>", short: "<>", group: "structure",
      surfaces: ["slash", "toolbar"], keywords: ["pre", "snippet"],
      run: (e, ctx) => atCursor((c) => c.toggleCodeBlock())(e, ctx),
      isActive: (e) => e.isActive("codeBlock"),
    },
    {
      id: "divider", title: "Divider", icon: "—", group: "structure",
      surfaces: ["slash", "toolbar"], keywords: ["hr", "rule", "separator", "line"],
      run: atCursor((c) => c.setHorizontalRule()),
    },

    {
      id: "toggle",
      title: "Toggle list",
      icon: "▶",
      group: "structure",
      surfaces: ["slash", "toolbar"],
      keywords: ["toggle", "collapse", "collapsible", "fold", "details", "accordion", "expand"],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        editor.commands.focus();
        insertToggle()({
          state: editor.state,
          dispatch: (tr: any) => editor.view.dispatch(tr),
        });
      },
      isActive: (e) => e.isActive("toggleBlock"),
    },

    // ── Callouts ────────────────────────────────────────────────────────────
    // One action per variant, and it does double duty: outside a callout it
    // wraps, inside one it re-styles. That's what removes the need for a React
    // node view with a variant picker — the existing menus already are one.
    ...CALLOUT_VARIANTS.map((variant): BlockAction => ({
      id: `callout:${variant}`,
      title: CALLOUT_LABELS[variant],
      icon: CALLOUT_ICONS[variant],
      group: "callout",
      surfaces: ["slash", "toolbar"],
      keywords: ["callout", "admonition", "aside", "box", "panel", CALLOUT_LABELS[variant].toLowerCase()],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        if (editor.isActive("calloutBlock")) {
          editor.chain().focus().updateAttributes("calloutBlock", { variant }).run();
        } else {
          editor.chain().focus().toggleWrap("calloutBlock", { variant }).run();
        }
      },
      isActive: (editor) => editor.isActive("calloutBlock", { variant }),
    })),

    // ── Containers ──────────────────────────────────────────────────────────
    ...CONTAINER_STYLES.map((style): BlockAction => ({
      id: `container:${style}`,
      title: CONTAINER_LABELS[style],
      icon: "▭",
      group: "container",
      surfaces: ["slash", "toolbar"],
      keywords: ["container", "group", "div", "box", "panel", "card", "section"],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        if (editor.isActive("containerBlock")) {
          editor.chain().focus().updateAttributes("containerBlock", { style }).run();
        } else {
          editor.chain().focus().toggleWrap("containerBlock", { style }).run();
        }
      },
      isActive: (editor) => editor.isActive("containerBlock", { style }),
    })),

    // ── Columns ─────────────────────────────────────────────────────────────
    ...([2, 3, 4] as const).map((count): BlockAction => ({
      id: `columns:${count}`,
      title: `${count} columns`,
      icon: "▥",
      group: "container",
      surfaces: ["slash", "toolbar"],
      keywords: ["column", "columns", "row", "side by side", "split", "grid"],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        editor.commands.focus();
        insertColumns(count)({
          state: editor.state,
          dispatch: (tr: any) => editor.view.dispatch(tr),
        });
      },
      // Nesting a row inside a column is legal in the schema but a usability
      // trap at this width, so it isn't offered.
      isAvailable: (e) => !e.isActive("columnBlock"),
    })),
    {
      id: "columnAdd",
      title: "Add column",
      icon: "+▥",
      group: "container",
      surfaces: ["toolbar"],
      isAvailable: (e) => e.isActive("columnBlock"),
      run: (e) => {
        e.commands.focus();
        addColumn()({ state: e.state, dispatch: (tr: any) => e.view.dispatch(tr) });
      },
    },
    {
      id: "columnDelete",
      title: "Delete column",
      icon: "−▥",
      group: "container",
      surfaces: ["toolbar"],
      danger: true,
      isAvailable: (e) => e.isActive("columnBlock"),
      run: (e) => {
        e.commands.focus();
        // At two columns this collapses the whole row: `column{2,}` makes a
        // one-column row invalid, so deleting the node alone would leave a
        // document the schema rejects.
        deleteColumn()({ state: e.state, dispatch: (tr: any) => e.view.dispatch(tr) });
      },
    },

    // Offered only from inside one, because "unwrap" has no meaning outside.
    // Backspace-at-start does the same thing; this is the discoverable route.
    {
      id: "unwrapContainer",
      title: "Remove surrounding box",
      icon: "⤴",
      group: "container",
      surfaces: ["toolbar"],
      keywords: ["unwrap", "lift", "remove", "ungroup"],
      isAvailable: (e) => e.isActive("calloutBlock") || e.isActive("containerBlock"),
      run: (e) => {
        e.commands.focus();
        // Same unwrap as Backspace-at-start, NOT Tiptap's lift(): lift splits
        // a multi-child container around the caret, and two routes to "remove
        // this box" that disagree about the contents is worse than one.
        unwrapNearestContainer(e as any, STRUCTURAL_CONTAINERS);
      },
    },

    // ── Math ────────────────────────────────────────────────────────────────
    {
      id: "inlineMath", title: "Inline Math", icon: "√x", group: "math",
      surfaces: ["slash", "toolbar"], keywords: ["latex", "equation", "formula", "katex"],
      run: (e, ctx) => {
        if (ctx?.range) e.chain().focus().deleteRange(ctx.range).run();
        opts.onInlineMath?.(e);
      },
    },
    {
      id: "blockMath", title: "Math Block", icon: "∑", group: "math",
      surfaces: ["slash", "toolbar"], keywords: ["latex", "equation", "display", "katex"],
      run: (e, ctx) => {
        if (ctx?.range) e.chain().focus().deleteRange(ctx.range).run();
        opts.onBlockMath?.(e);
      },
    },

    // ── Table ───────────────────────────────────────────────────────────────
    {
      id: "table", title: "Table", icon: "⊞", short: "+ Table", group: "table",
      surfaces: ["slash", "toolbar"], keywords: ["grid", "rows", "columns"],
      run: atCursor((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
      // The toolbar used to swap this button set imperatively; expressing it as
      // availability means the slash menu gets the same rule for free.
      isAvailable: (e) => !inTable(e),
    },
    { id: "tableRowAfter", title: "Row below", icon: "+row", group: "table", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addRowAfter().run() },
    { id: "tableRowDelete", title: "Delete row", icon: "−row", group: "table", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().deleteRow().run() },
    { id: "tableColAfter", title: "Column right", icon: "+col", group: "table", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addColumnAfter().run() },
    { id: "tableColDelete", title: "Delete column", icon: "−col", group: "table", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().deleteColumn().run() },
    { id: "tableDelete", title: "Delete table", icon: "del⊞", group: "table", surfaces: ["toolbar"], isAvailable: inTable, danger: true, run: (e) => e.chain().focus().deleteTable().run() },
  ];

  // ── Link ──────────────────────────────────────────────────────────────────
  if (opts.onEditLink) {
    actions.push({
      id: "link",
      title: "Link",
      icon: "🔗",
      short: "🔗",
      group: "format",
      surfaces: ["toolbar", "bubble"],
      shortcut: "⌘K",
      keywords: ["url", "href", "anchor"],
      run: (e) => opts.onEditLink!(e),
      isActive: (e) => e.isActive("link"),
    });
  }

  // ── Vault-specific ────────────────────────────────────────────────────────
  actions.push({
    id: "unsetHighlight", title: "Clear highlight", icon: "🖊", short: "🖊", group: "vault",
    surfaces: ["toolbar"],
    run: (e) => e.chain().focus().unsetHighlight().run(),
    isActive: (e) => e.isActive("highlight"),
  });

  for (const cat of opts.highlighters ?? []) {
    actions.push({
      id: `highlight:${cat.name}`,
      title: cat.name,
      icon: "▮",
      group: "vault",
      surfaces: ["toolbar", "bubble"],
      run: () => opts.onApplyHighlighter?.(cat),
    });
  }

  if (opts.onEditHighlighters) {
    actions.push({
      id: "editHighlighters", title: "Edit highlighters", icon: "✎", group: "vault",
      surfaces: ["toolbar"],
      run: () => opts.onEditHighlighters!(),
    });
  }

  if (opts.onDatabaseInsert) {
    actions.push({
      id: "databaseInsert",
      title: "Insert from Database",
      icon: "◉",
      short: "◉ DB",
      group: "vault",
      surfaces: ["slash", "toolbar"],
      keywords: ["record", "db", "database"],
      run: (e, ctx) => opts.onDatabaseInsert!(e, ctx),
    });
  }

  // ── History ───────────────────────────────────────────────────────────────
  actions.push(
    { id: "undo", title: "Undo", icon: "↩", group: "history", surfaces: ["toolbar"], shortcut: "⌘Z", run: (e) => e.chain().focus().undo().run() },
    { id: "redo", title: "Redo", icon: "↪", group: "history", surfaces: ["toolbar"], shortcut: "⇧⌘Z", run: (e) => e.chain().focus().redo().run() }
  );

  return actions;
}

/** Actions for one surface, in registry order. Availability is applied later,
 *  against a live editor, so this stays cheap and editor-free. */
export function actionsFor(registry: BlockAction[], surface: BlockSurface): BlockAction[] {
  return registry.filter((a) => a.surfaces.includes(surface));
}

/** Case-insensitive match over title and keywords, for the slash menu. */
export function matchesQuery(action: BlockAction, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (action.title.toLowerCase().includes(q)) return true;
  return (action.keywords ?? []).some((k) => k.toLowerCase().includes(q));
}

/** Label shown above the first action of each group in the slash menu. */
export const GROUP_LABELS: Record<BlockGroup, string> = {
  format: "Format",
  text: "Text",
  lists: "Lists",
  structure: "Blocks",
  callout: "Callout",
  container: "Group",
  math: "Math",
  table: "Table",
  vault: "Vault",
  history: "History",
};
