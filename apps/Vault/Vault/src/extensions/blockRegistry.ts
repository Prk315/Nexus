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
import { CARD_COLORS } from "./structural/cardColor";
import { unwrapNearestContainer } from "./structural/containerCommands";
import { insertToggle } from "./structural/toggleCommands";
import { insertColumns, addColumn, deleteColumn } from "./structural/columnCommands";
import { CODE_LANGUAGES } from "./noteCodeBlock";
import { NOTE_WIDTHS, NOTE_WIDTH_LABELS, DEFAULT_NOTE_WIDTH } from "./noteDocument";
import { headingForSelection, toggleFoldAtSelection, setAllHeadingFolds } from "./headingFold";

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
  | "cardColor"  // background tint for a callout/container
  | "math"
  | "table"       // insert a table
  | "tableOps"    // row/column editing, inline, only inside a table
  | "tableMore"   // header toggles, merge/split, delete — behind a menu
  | "media"      // images
  | "align"
  | "color"
  | "code"       // code-block language, only inside one
  | "width"      // per-note page width
  | "fold"       // collapse / expand heading sections
  | "vault"      // highlighters, database records
  | "history";

/**
 * Text colours offered in the bubble menu.
 *
 * A short, deliberate list rather than a colour wheel: an arbitrary hex picker
 * in a note editor produces documents that look like ransom notes and can't be
 * restyled later. These are the app's own semantic hues, so coloured text
 * matches the callouts and the rest of Vault.
 */
export const TEXT_COLORS: Array<{ id: string; label: string; value: string | null }> = [
  { id: "default", label: "Default", value: null },
  { id: "muted", label: "Muted", value: "oklch(0.55 0 0)" },
  { id: "red", label: "Red", value: "oklch(0.577 0.245 27.325)" },
  { id: "amber", label: "Amber", value: "oklch(0.55 0.12 82)" },
  { id: "green", label: "Green", value: "oklch(0.50 0.15 140)" },
  { id: "blue", label: "Blue", value: "oklch(0.40 0.10 265)" },
];

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
  /** Opens a file picker; the extension handles the upload. */
  onPickImage?: (editor: Editor) => void;
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
    // A document title, not a fifth heading rank: a `title`-flagged level-1
    // heading (see headingFold.ts) rather than a new node, so it folds and
    // outlines exactly like any other heading — only its CSS differs.
    {
      id: "title",
      title: "Title",
      icon: "Tt",
      short: "Tt",
      group: "text",
      surfaces: ["slash", "toolbar"],
      keywords: ["title", "display", "big", "cover"],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        if (editor.isActive("heading", { title: true })) {
          editor.chain().focus().setParagraph().run();
        } else {
          editor.chain().focus().setNode("heading", { level: 1, title: true }).run();
        }
      },
      isActive: (e) => e.isActive("heading", { title: true }),
    },

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

    // ── Card colour ─────────────────────────────────────────────────────────
    // Applies to whichever of the two structural "card" types is active — a
    // callout's variant already implies a tint, this overrides it; a
    // container has none, so this is the only way it gets one.
    ...CARD_COLORS.map((c): BlockAction => ({
      id: `cardColor:${c.id}`,
      title: c.label,
      icon: "●",
      group: "cardColor",
      surfaces: ["toolbar"],
      isAvailable: (e) => e.isActive("containerBlock") || e.isActive("calloutBlock"),
      isActive: (e) => {
        const want = c.id === "default" ? null : c.id;
        return e.isActive("containerBlock", { color: want }) || e.isActive("calloutBlock", { color: want });
      },
      run: (e) => {
        e.commands.focus();
        const color = c.id === "default" ? null : c.id;
        const type = e.isActive("containerBlock") ? "containerBlock" : "calloutBlock";
        e.chain().focus().updateAttributes(type, { color }).run();
      },
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
      // Deliberately NOT gated on being outside a row any more. Nesting was
      // always legal in the schema — `column` is `block+` and `columnBlock` is
      // a block — and this guard was the only thing preventing it. Columns
      // inside columns, boxes inside columns and columns inside boxes all
      // compose to arbitrary depth; see structural/nesting.test.ts.
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

    // ── Media ───────────────────────────────────────────────────────────────
    // Paste and drag-drop are handled in the extension itself; this is the
    // explicit route. Every path uploads to Storage first — see noteImage.ts.
    {
      id: "image",
      title: "Image",
      icon: "🖼",
      group: "media",
      surfaces: ["slash", "toolbar"],
      keywords: ["image", "picture", "photo", "screenshot", "upload"],
      run: (editor, ctx) => {
        if (ctx?.range) editor.chain().focus().deleteRange(ctx.range).run();
        opts.onPickImage?.(editor);
      },
    },

    // ── Alignment ───────────────────────────────────────────────────────────
    ...(["left", "center", "right"] as const).map((align): BlockAction => ({
      id: `align:${align}`,
      title: `Align ${align}`,
      icon: align === "left" ? "⇤" : align === "center" ? "↔" : "⇥",
      group: "align",
      surfaces: ["toolbar"],
      keywords: ["align", align],
      run: (e) => e.chain().focus().setTextAlign(align).run(),
      isActive: (e) => e.isActive({ textAlign: align }),
    })),

    // ── Text colour ─────────────────────────────────────────────────────────
    ...TEXT_COLORS.map((c): BlockAction => ({
      id: `color:${c.id}`,
      title: c.label,
      icon: "A",
      group: "color",
      surfaces: ["bubble"],
      run: (e) =>
        c.value
          ? e.chain().focus().setColor(c.value).run()
          : e.chain().focus().unsetColor().run(),
      isActive: (e) => (c.value ? e.isActive("textStyle", { color: c.value }) : false),
    })),

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
    // ── Table editing ───────────────────────────────────────────────────────
    // `tableOps` is INLINE, not folded into "Insert ▾" like the rest of the
    // table group. These only exist while the caret is in a table, and when
    // you're in one they're the whole point — burying row/column editing two
    // clicks deep in an insert menu made the table feel read-only.
    { id: "tableRowBefore", title: "Insert row above", icon: "⤒row", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addRowBefore().run() },
    { id: "tableRowAfter", title: "Insert row below", icon: "⤓row", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addRowAfter().run() },
    { id: "tableRowDelete", title: "Delete row", icon: "−row", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, danger: true, run: (e) => e.chain().focus().deleteRow().run() },
    { id: "tableColBefore", title: "Insert column left", icon: "⇤col", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addColumnBefore().run() },
    { id: "tableColAfter", title: "Insert column right", icon: "⇥col", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().addColumnAfter().run() },
    { id: "tableColDelete", title: "Delete column", icon: "−col", group: "tableOps", surfaces: ["toolbar"], isAvailable: inTable, danger: true, run: (e) => e.chain().focus().deleteColumn().run() },

    // The rest live behind a "Table ▾" menu that also only appears inside a
    // table — useful, but not worth six more permanent buttons in a toolbar
    // that already doesn't wrap.
    { id: "tableHeaderRow", title: "Toggle header row", icon: "▤", group: "tableMore", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().toggleHeaderRow().run() },
    { id: "tableHeaderCol", title: "Toggle header column", icon: "▥", group: "tableMore", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().toggleHeaderColumn().run() },
    { id: "tableMergeSplit", title: "Merge / split cells", icon: "⿴", group: "tableMore", surfaces: ["toolbar"], isAvailable: inTable, run: (e) => e.chain().focus().mergeOrSplit().run() },
    { id: "tableFix", title: "Repair table", icon: "⚒", group: "tableMore", surfaces: ["toolbar"], keywords: ["fix", "repair"], isAvailable: inTable, run: (e) => e.chain().focus().fixTables().run() },
    { id: "tableDelete", title: "Delete table", icon: "⌫", group: "tableMore", surfaces: ["toolbar"], isAvailable: inTable, danger: true, run: (e) => e.chain().focus().deleteTable().run() },
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

  // ── Code block language ───────────────────────────────────────────────────
  // One action per language, available only inside a code block. Expressing it
  // this way means the existing "Insert ▾" menu renders the whole picker for
  // free — empty groups are already filtered out, so these are invisible
  // everywhere else and cost no new UI code.
  for (const lang of CODE_LANGUAGES) {
    const value = lang.value === "plaintext" ? null : lang.value;
    actions.push({
      id: `codeLang:${lang.value}`,
      title: lang.label,
      icon: "⌗",
      group: "code",
      surfaces: ["toolbar"],
      isAvailable: (e) => e.isActive("codeBlock"),
      isActive: (e) => e.isActive("codeBlock", { language: value }),
      run: (e) => e.chain().focus().updateAttributes("codeBlock", { language: value }).run(),
    });
  }

  // ── Note width ────────────────────────────────────────────────────────────
  // A property of the note, stored on the doc node, so it follows the note to
  // every device instead of living in this browser's localStorage.
  for (const w of NOTE_WIDTHS) {
    actions.push({
      id: `noteWidth:${w}`,
      title: NOTE_WIDTH_LABELS[w],
      icon: w === "auto" ? "▯" : w === "wide" ? "▭" : "▬",
      group: "width",
      surfaces: ["toolbar"],
      keywords: ["width", "wide", "narrow", "page", "measure"],
      isActive: (e) => (e.state.doc.attrs.width ?? DEFAULT_NOTE_WIDTH) === w,
      run: (e) => {
        // A doc-level attribute needs a plain transaction; there is no
        // updateAttributes for the top node.
        const tr = e.state.tr.setDocAttribute("width", w);
        e.view.dispatch(tr);
      },
    });
  }

  // ── Sketch ────────────────────────────────────────────────────────────────
  actions.push({
    id: "sketch",
    title: "Sketch",
    // Not ✎ — the Note callout and the highlighter-categories button already
    // use it, and three identical pencils in one menu is a coin toss.
    icon: "✍",
    group: "media",
    surfaces: ["slash", "toolbar"],
    keywords: ["draw", "sketch", "canvas", "diagram", "ink", "pen"],
    run: atCursor((c) => c.insertSketch()),
  });

  // ── Folding ───────────────────────────────────────────────────────────────
  // Section folding is a VIEW state, not an edit — see extensions/headingFold.ts
  // for why it is decorations over a flat document rather than a container node.
  actions.push(
    {
      id: "fold:toggle",
      title: "Fold section",
      icon: "⌄",
      group: "fold",
      surfaces: ["toolbar"],
      shortcut: "⌥⌘.",
      keywords: ["fold", "collapse", "section", "heading"],
      // Only offered where there is a heading to fold. `isAvailable` rather
      // than a no-op button: a control that silently does nothing is worse
      // than one that isn't there.
      isAvailable: (e) => headingForSelection(e.state.doc, e.state.selection.head) != null,
      isActive: (e) => {
        const at = headingForSelection(e.state.doc, e.state.selection.head);
        return at != null && e.state.doc.nodeAt(at)?.attrs.collapsed === true;
      },
      run: (e) => { toggleFoldAtSelection(e.view); },
    },
    {
      id: "fold:all",
      title: "Fold all sections",
      icon: "⌃",
      group: "fold",
      surfaces: ["toolbar"],
      keywords: ["fold", "collapse", "all"],
      run: (e) => { setAllHeadingFolds(e.view, true); },
    },
    {
      id: "fold:none",
      title: "Expand all sections",
      icon: "⌄",
      group: "fold",
      surfaces: ["toolbar"],
      keywords: ["unfold", "expand", "all"],
      run: (e) => { setAllHeadingFolds(e.view, false); },
    }
  );

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
  cardColor: "Card colour",
  math: "Math",
  media: "Media",
  align: "Align",
  color: "Colour",
  code: "Language",
  width: "Note width",
  fold: "Sections",
  table: "Table",
  tableOps: "Table",
  tableMore: "Table",
  vault: "Vault",
  history: "History",
};
