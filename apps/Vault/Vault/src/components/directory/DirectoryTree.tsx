import { Fragment, useMemo, useRef, useState } from "react";
import { VaultGraph } from "../../types";
import {
  FlatRow,
  GuideSegment,
  draftGuides,
  flattenTree,
  guideHighlight,
  rootNodeIds,
  subtreeEnd,
} from "./treeFlatten";
import { iconForKindName, isFolder, kindLabel, safeIcon } from "./nodeMeta";

// The flush-left tree.
//
// Every row's text starts at the same x. Depth is the strip of grey guide
// segments before it — see treeFlatten.ts for what each segment means. There is
// no "Shared with you" section: a shared node sits wherever it lives, with a dot.
//
// Creating lives HERE rather than in a block above the tree. The old block
// (name field, kind selector, three import buttons) could only make root nodes,
// so every "new note in this folder" was two steps — make it, then drag or link
// it. A "+" on the row names the parent by construction.

export type ImportKind = "Pdf" | "Video" | "Parsed";

/** The kinds the old selector offered, in its order. */
const CREATE_KINDS = [
  "Note",
  "Folder",
  "Canvas",
  "CodeFile",
  "Table",
  "Database",
  "Workbook",
  "Journal",
  "Books",
];

const IMPORTS: { kind: ImportKind; label: string }[] = [
  { kind: "Pdf", label: "Import PDF…" },
  { kind: "Video", label: "Import Video…" },
  { kind: "Parsed", label: "Import Parsed folder…" },
];

interface Props {
  graph: VaultGraph;
  selectedId: string | null;
  expanded: Set<string>;
  currentUserId?: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  /** parentId === null creates a root node, as the old block did. */
  onCreate: (parentId: string | null, name: string, kind: string) => void;
  /** Reuses App's existing import handlers; the parent is attached afterwards. */
  onImport: (parentId: string | null, kind: ImportKind) => void;
  onUnlink?: (parentId: string, childId: string) => void;
  onToggleShare?: (id: string, isShared: boolean) => void;
  /** Pressing a folder row drives the graph and the directory pane. */
  onFocusFolder?: (id: string) => void;
  importingParsed?: boolean;
}

interface Draft {
  /** null = a new root node. */
  parentId: string | null;
  /** Row key of the parent, so the draft can be placed in the flat list. */
  parentKey: string | null;
  kind: string;
}

export function DirectoryTree({
  graph,
  selectedId,
  expanded,
  currentUserId,
  onSelect,
  onToggle,
  onDelete,
  onCreate,
  onImport,
  onUnlink,
  onToggleShare,
  onFocusFolder,
  importingParsed,
}: Props) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  /**
   * Which row's "+" menu is open ("" is the root-level one), and where the
   * button was when it opened.
   *
   * ⚠️ The menu is positioned FIXED from that rect rather than absolutely
   * inside the row. The tree scrolls inside `overflow: auto`, which clips an
   * absolutely positioned child — so the menu on the last visible row, which is
   * exactly the row you press when adding to the end of a folder, would open
   * into the clipped region and appear not to open at all.
   */
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const menuFor = menu?.key ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState("");
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const rows = useMemo(
    () => flattenTree(graph, rootNodeIds(graph), expanded, { currentUserId }),
    [graph, expanded, currentUserId],
  );

  // The guide lights for whatever the pointer is on, falling back to the
  // selection — so the path stays visible when the pointer leaves the sidebar.
  const activeKey = hoverKey ?? rows.find((r) => r.nodeId === selectedId)?.key ?? null;
  const lit = useMemo(() => guideHighlight(rows, activeKey), [rows, activeKey]);

  /** Where the draft row sits: after the parent's whole subtree, or at the top. */
  const draftAt = useMemo(() => {
    if (!draft) return -1;
    if (!draft.parentKey) return 0;
    const i = rows.findIndex((r) => r.key === draft.parentKey);
    return i < 0 ? -1 : subtreeEnd(rows, i);
  }, [draft, rows]);

  const draftParent = draft?.parentKey
    ? rows.find((r) => r.key === draft.parentKey) ?? null
    : null;

  /** `""` is the root-level menu; any other key is a row's. */
  function toggleMenu(key: string, button: HTMLElement) {
    setMenu((open) => {
      if (open?.key === key) return null;
      const r = button.getBoundingClientRect();
      return { key, x: r.right, y: r.bottom };
    });
  }

  function startDraft(parentId: string | null, parentKey: string | null, kind: string) {
    setMenu(null);
    // Type into a folder that is closed and the row appears nowhere. Open it.
    if (parentId && !expanded.has(parentId)) onToggle(parentId);
    setDraft({ parentId, parentKey, kind });
    setDraftName("");
  }

  function commitDraft() {
    if (!draft) return;
    const name = draftName.trim();
    if (!name) return;
    onCreate(draft.parentId, name, draft.kind);
    setDraft(null);
    setDraftName("");
  }

  function cancelDraft() {
    setDraft(null);
    setDraftName("");
    // Hand focus back to the row the draft came from, or the list keeps it.
    if (draft?.parentKey) rowRefs.current[draft.parentKey]?.focus();
  }

  const renderMenu = (key: string, parentId: string | null, parentKey: string | null) =>
    menu?.key === key ? (
      <CreateMenu
        at={menu}
        parentName={parentId ? graph.nodes[parentId]?.name ?? "" : null}
        importingParsed={importingParsed}
        onPick={(kind) => startDraft(parentId, parentKey, kind)}
        onImport={(kind) => {
          setMenu(null);
          onImport(parentId, kind);
        }}
        onClose={() => {
          setMenu(null);
          if (parentKey) rowRefs.current[parentKey]?.focus();
        }}
      />
    ) : null;

  const draftRow = (d: Draft, guides: GuideSegment[]) => (
    <div className="dtree-row is-draft">
      <span className="dtree-guides" aria-hidden="true">
        {guides.map((g, i) => (
          <span key={i} className={`dtree-guide g-${g.kind}`} />
        ))}
      </span>
      <span className="dtree-twisty is-leaf">·</span>
      <span className="dtree-icon">{iconForKindName(d.kind)}</span>
      <input
        className="dtree-draft-input"
        autoFocus
        placeholder={`New ${d.kind.toLowerCase()}…`}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelDraft();
          }
        }}
        onBlur={() => {
          // A half-typed name is worth less than a stray empty node.
          if (!draftName.trim()) cancelDraft();
        }}
      />
      <span className="dtree-draft-hint">↵ create · esc cancel</span>
    </div>
  );

  return (
    <div className="dtree" role="tree">
      <div className="dtree-roothead">
        <span>Vault</span>
        <span className="dtree-root-add">
          <button
            className="dtree-add-btn"
            title="New node at the top level"
            aria-haspopup="menu"
            aria-expanded={menuFor === ""}
            onClick={(e) => toggleMenu("", e.currentTarget)}
          >
            +
          </button>
          {renderMenu("", null, null)}
        </span>
      </div>

      {rows.length === 0 && draftAt !== 0 && (
        <div className="dtree-empty">Nothing here yet — press + to make something.</div>
      )}

      {draft && draftAt === 0 && draftRow(draft, draftGuides(null))}

      {rows.map((row, i) => (
        <Fragment key={row.key}>
          <Row
            row={row}
            index={i}
            graph={graph}
            lit={lit}
            isSelected={row.nodeId === selectedId}
            isHovered={hoverKey === row.key}
            menuOpen={menuFor === row.key}
            registerRef={(el) => {
              rowRefs.current[row.key] = el;
            }}
            onHover={setHoverKey}
            onSelect={onSelect}
            onToggle={onToggle}
            onDelete={onDelete}
            onUnlink={onUnlink}
            onToggleShare={onToggleShare}
            onFocusFolder={onFocusFolder}
            onOpenMenu={(button) => toggleMenu(row.key, button)}
            menuSlot={renderMenu(row.key, row.nodeId, row.key)}
          />
          {draft && draftAt === i + 1 && draftRow(draft, draftGuides(draftParent))}
        </Fragment>
      ))}
    </div>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────

interface RowProps {
  row: FlatRow;
  index: number;
  graph: VaultGraph;
  lit: Set<string>;
  isSelected: boolean;
  isHovered: boolean;
  menuOpen: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  onHover: (key: string | null) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUnlink?: (parentId: string, childId: string) => void;
  onToggleShare?: (id: string, isShared: boolean) => void;
  onFocusFolder?: (id: string) => void;
  /** Takes the button so the menu can be placed against it. */
  onOpenMenu: (button: HTMLElement) => void;
  menuSlot: React.ReactNode;
}

function Row({
  row,
  index,
  graph,
  lit,
  isSelected,
  isHovered,
  menuOpen,
  registerRef,
  onHover,
  onSelect,
  onToggle,
  onDelete,
  onUnlink,
  onToggleShare,
  onFocusFolder,
  onOpenMenu,
  menuSlot,
}: RowProps) {
  const node = graph.nodes[row.nodeId];
  if (!node) return null;
  const folder = isFolder(node.kind);

  function activate() {
    onSelect(row.nodeId);
    if (folder) onFocusFolder?.(row.nodeId);
  }

  // Scoped to the row — this branch adds no window-level key handler, so these
  // keys cannot fight the app-wide bindings in hooks/useKeyBindings.ts.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "+" || e.key === "n") {
      e.preventDefault();
      // Anchor on the row's own "+" so the keyboard path lands where the
      // pointer path would, not in the corner of the screen.
      const button = e.currentTarget.querySelector(".dtree-add-btn");
      onOpenMenu((button as HTMLElement | null) ?? (e.currentTarget as HTMLElement));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else if (e.key === "ArrowRight" && row.hasChildren && !row.expanded) {
      e.preventDefault();
      onToggle(row.nodeId);
    } else if (e.key === "ArrowLeft" && row.hasChildren && row.expanded) {
      e.preventDefault();
      onToggle(row.nodeId);
    }
  }

  return (
    <div
      className={`dtree-row${isSelected ? " is-selected" : ""}${isHovered ? " is-hovered" : ""}${menuOpen ? " is-menu-open" : ""}`}
      role="treeitem"
      tabIndex={0}
      ref={registerRef}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={isSelected}
      onMouseEnter={() => onHover(row.key)}
      onMouseLeave={() => onHover(null)}
      onKeyDown={onKeyDown}
      onClick={activate}
    >
      {/* Depth, drawn rather than indented. */}
      <span className="dtree-guides" aria-hidden="true">
        {row.guides.map((g, d) => (
          <span
            key={d}
            className={`dtree-guide g-${g.kind}${lit.has(`${index}:${d}`) ? " is-lit" : ""}`}
          />
        ))}
      </span>

      <button
        className={`dtree-twisty${row.hasChildren ? "" : " is-leaf"}`}
        tabIndex={-1}
        aria-hidden={!row.hasChildren}
        onClick={(e) => {
          e.stopPropagation();
          if (row.hasChildren) onToggle(row.nodeId);
        }}
        title={row.hasChildren ? (row.expanded ? "Collapse" : "Expand") : undefined}
      >
        {row.hasChildren ? (row.expanded ? "▾" : "▸") : "·"}
      </button>

      <span className="dtree-icon" title={kindLabel(node.kind)}>
        {safeIcon(node.kind)}
      </span>
      <span className="dtree-name">{node.name}</span>

      {row.shared && (
        <span
          className={`dtree-shared${row.foreign ? " is-foreign" : ""}`}
          title={row.foreign ? "Shared with you" : "Shared by you"}
        >
          ●
        </span>
      )}

      <span className="dtree-actions">
        {onToggleShare && (
          <button
            className={`share-btn${row.shared ? " share-active" : ""}`}
            tabIndex={-1}
            title={row.shared ? "Unshare" : "Share"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleShare(row.nodeId, row.shared);
            }}
          >
            ⇄
          </button>
        )}
        {row.parentId && onUnlink && (
          <button
            className="unlink-btn"
            tabIndex={-1}
            title="Remove connection to parent"
            onClick={(e) => {
              e.stopPropagation();
              onUnlink(row.parentId!, row.nodeId);
            }}
          >
            ⊘
          </button>
        )}
        <button
          className="delete-btn"
          tabIndex={-1}
          title="Delete node"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(row.nodeId);
          }}
        >
          ×
        </button>
        <span className="dtree-add-wrap">
          <button
            className="dtree-add-btn"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={folder ? `New node inside "${node.name}"` : `New node under "${node.name}"`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(e.currentTarget);
            }}
          >
            +
          </button>
          {menuSlot}
        </span>
      </span>
    </div>
  );
}

// ── The "+" menu ────────────────────────────────────────────────────────────

interface MenuProps {
  /** Viewport coordinates of the button's bottom-right corner. */
  at: { x: number; y: number };
  parentName: string | null;
  importingParsed?: boolean;
  onPick: (kind: string) => void;
  onImport: (kind: ImportKind) => void;
  onClose: () => void;
}

const MENU_W = 200;
const MENU_H = 330;

function CreateMenu({ at, parentName, importingParsed, onPick, onImport, onClose }: MenuProps) {
  // Clamped into the viewport rather than flipped: a menu that flips above the
  // button for the bottom half of the list moves under the pointer, and the
  // list is exactly where you press "+" repeatedly.
  const vw = typeof window === "undefined" ? MENU_W : window.innerWidth;
  const vh = typeof window === "undefined" ? MENU_H : window.innerHeight;
  const left = Math.max(8, Math.min(at.x - MENU_W, vw - MENU_W - 8));
  const top = Math.max(8, Math.min(at.y + 4, vh - MENU_H - 8));

  return (
    <>
      {/* Dismissal without a document-level listener: the backdrop IS the
          outside. It also stops a click landing on a row underneath. */}
      <div
        className="dtree-menu-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        className="dtree-menu"
        role="menu"
        style={{ left, top, width: MENU_W }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dtree-menu-head">
          {parentName ? `Inside ${parentName}` : "At the top level"}
        </div>
        {CREATE_KINDS.map((kind, i) => (
          <button
            key={kind}
            className="dtree-menu-item"
            role="menuitem"
            autoFocus={i === 0}
            onClick={() => onPick(kind)}
          >
            <span className="dtree-menu-icon">{safeIcon({ type: kind } as never)}</span>
            New {kind.toLowerCase()}
          </button>
        ))}
        <div className="dtree-menu-sep" />
        {IMPORTS.map((imp) => (
          <button
            key={imp.kind}
            className="dtree-menu-item"
            role="menuitem"
            disabled={imp.kind === "Parsed" && importingParsed}
            onClick={() => onImport(imp.kind)}
          >
            <span className="dtree-menu-icon">↥</span>
            {imp.kind === "Parsed" && importingParsed ? "Importing…" : imp.label}
          </button>
        ))}
      </div>
    </>
  );
}
