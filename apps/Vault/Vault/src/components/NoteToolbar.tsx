// The note editor's toolbar, rendered entirely from the block registry.
//
// Previously ~50 lines of hand-written JSX that had to be kept in step with
// the slash menu by hand. Now the only decisions made here are presentational:
// which groups stay inline, which collapse into a menu, and where the
// separators go.

import { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { actionsFor, GROUP_LABELS, type BlockAction, type BlockGroup } from "../extensions/blockRegistry";

// Groups shown as bare buttons, in this order.
//
// `tableOps` is here rather than in the Insert menu on purpose: every action in
// it is gated on the caret being inside a table, so it costs nothing the rest
// of the time — and when you ARE in a table, adding and removing rows and
// columns is the whole job. Folding it into "Insert ▾" made tables feel
// read-only, which is the regression this ordering fixes.
const INLINE_GROUPS: BlockGroup[] = ["format", "text", "lists", "align", "tableOps"];
// Groups folded behind a single "Insert ▾" menu — they're occasional, and
// .tiptap-toolbar doesn't wrap, so ~25 bare buttons would simply clip.
const MENU_GROUPS: BlockGroup[] = ["structure", "callout", "container", "media", "math", "table", "code"];
// Its own menu, which only materialises inside a table: header toggles,
// merge/split, repair and delete are worth having but not worth five more
// permanent buttons.
const TABLE_MENU_GROUPS: BlockGroup[] = ["tableMore"];
// Page width is a per-note setting rather than an insertable thing, so it gets
// its own small menu at the end rather than living under "Insert".
const WIDTH_MENU_GROUPS: BlockGroup[] = ["width"];
// Trailing groups, shown inline after the menu.
const TAIL_GROUPS: BlockGroup[] = ["vault", "history"];

interface Props {
  editor: Editor;
  registry: BlockAction[];
  /** Swatch colours for highlighter actions, keyed by action id. */
  swatches?: Record<string, string>;
  /** Rendered at the end of the toolbar (e.g. the outline toggle). */
  trailing?: React.ReactNode;
}

export function NoteToolbar({ editor, registry, swatches, trailing }: Props) {
  const toolbarActions = actionsFor(registry, "toolbar");

  // One deep-compared snapshot of every button's state, recomputed only when a
  // flag actually flips. The editor re-renders on every transaction — including
  // pure cursor moves — so calling isActive() inline meant ~25 schema lookups
  // per keystroke and a full re-render even when nothing had changed.
  const flags = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const out: Record<string, { active: boolean; available: boolean }> = {};
      for (const a of toolbarActions) {
        out[a.id] = {
          active: a.isActive?.(ed) ?? false,
          available: a.isAvailable?.(ed) ?? true,
        };
      }
      return out;
    },
  }) ?? {};

  const visible = (a: BlockAction) => flags[a.id]?.available ?? true;
  const byGroup = (g: BlockGroup) => toolbarActions.filter((a) => a.group === g && visible(a));

  const renderBtn = (a: BlockAction) => {
    const swatch = swatches?.[a.id];
    return (
      <button
        key={a.id}
        className={`tt-btn${flags[a.id]?.active ? " active" : ""}${a.danger ? " tt-btn-danger" : ""}${swatch ? " tt-hl-btn" : ""}`}
        onClick={() => a.run(editor)}
        type="button"
        title={a.shortcut ? `${a.title} (${a.shortcut})` : a.title}
        aria-label={a.title}
        aria-pressed={a.isActive ? flags[a.id]?.active ?? false : undefined}
      >
        {swatch && <span className="tt-hl-swatch" style={{ background: swatch }} />}
        {a.short ?? a.icon}
      </button>
    );
  };

  const inlineSections = INLINE_GROUPS.map(byGroup).filter((g) => g.length > 0);
  const menuSections = MENU_GROUPS.map((g) => [g, byGroup(g)] as const).filter(([, a]) => a.length > 0);
  const tableMenuSections = TABLE_MENU_GROUPS.map((g) => [g, byGroup(g)] as const).filter(([, a]) => a.length > 0);
  const widthMenuSections = WIDTH_MENU_GROUPS.map((g) => [g, byGroup(g)] as const).filter(([, a]) => a.length > 0);
  const tailSections = TAIL_GROUPS.map(byGroup).filter((g) => g.length > 0);

  return (
    <div className="tiptap-toolbar" role="toolbar" aria-label="Formatting">
      {inlineSections.map((group, i) => (
        <span key={group[0].id} className="tt-group">
          {i > 0 && <span className="tt-sep" />}
          {group.map(renderBtn)}
        </span>
      ))}

      {menuSections.length > 0 && (
        <>
          <span className="tt-sep" />
          <ToolbarMenu label="Insert" sections={menuSections} editor={editor} flags={flags} />
        </>
      )}

      {/* Appears only while the caret is inside a table — every action in it is
          gated on that, so outside one this renders nothing at all. */}
      {tableMenuSections.length > 0 && (
        <>
          <span className="tt-sep" />
          <ToolbarMenu label="Table" sections={tableMenuSections} editor={editor} flags={flags} />
        </>
      )}

      {widthMenuSections.length > 0 && (
        <>
          <span className="tt-sep" />
          <ToolbarMenu label="Width" sections={widthMenuSections} editor={editor} flags={flags} />
        </>
      )}

      {tailSections.map((group) => (
        <span key={group[0].id} className="tt-group">
          <span className="tt-sep" />
          {group.map(renderBtn)}
        </span>
      ))}

      {trailing}
    </div>
  );
}

function ToolbarMenu({
  label,
  sections,
  editor,
  flags,
}: {
  label: string;
  sections: ReadonlyArray<readonly [BlockGroup, BlockAction[]]>;
  editor: Editor;
  flags: Record<string, { active: boolean; available: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Pointer, not mouse: this menu has to close on an iPad tap too.
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="tt-menu-wrap" ref={wrapRef}>
      <button
        className={`tt-btn${open ? " active" : ""}`}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} ▾
      </button>
      {open && (
        <div className="tt-menu" role="menu">
          {sections.map(([group, actions]) => (
            <div key={group}>
              <div className="tt-menu-group">{GROUP_LABELS[group]}</div>
              {actions.map((a) => (
                <button
                  key={a.id}
                  role="menuitem"
                  className={`tt-menu-item${flags[a.id]?.active ? " active" : ""}${a.danger ? " danger" : ""}`}
                  type="button"
                  onClick={() => {
                    a.run(editor);
                    setOpen(false);
                  }}
                >
                  <span className="tt-menu-icon">{a.icon}</span>
                  <span className="tt-menu-label">{a.title}</span>
                  {a.shortcut && <span className="tt-menu-shortcut">{a.shortcut}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
