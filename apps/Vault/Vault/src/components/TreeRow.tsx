import { useState, useRef } from "react";
import { VaultGraph } from "../types";
import { nodeIcon } from "../nodeUtils";

// ⚠️ On a touch screen a row action may never be revealed by :hover.
//
// The row's ⇄ ★ ⊘ × buttons are `visibility: hidden` and revealed by
// `.tree-item:hover`. `visibility` RESERVES layout space, so × sits at a fixed
// position inside the row whether or not it is visible — and iOS applies a
// sticky `:hover` to whatever you just tapped. A double-tap near the right end
// of a row (which is just `.tree-label`, since it is `flex: 1`) therefore
// reveals × on the first tap and PRESSES it on the second. That is how two book
// nodes were deleted on an iPad by double-tapping them.
//
// So on coarse pointers every action lives behind ⋯, which is always visible
// and whose worst case is opening a menu. The row keeps exactly one affordance
// and nothing can materialise under a finger. App.css does the gating, so the
// desktop layout is untouched — see `@media (hover: none)` near `.tree-item`.

interface TreeRowProps {
  nodeId: string;
  graph: VaultGraph;
  selectedId: string | null;
  expanded: Set<string>;
  depth: number;
  parentId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string, name: string, kind: string) => void;
  onUnlink?: (parentId: string, childId: string) => void;
  onToggleFavorite?: (id: string, isFav: boolean) => void;
  onToggleShare?: (id: string, isShared: boolean) => void;
}

export function TreeRow({ nodeId, graph, selectedId, expanded, depth, parentId, onSelect, onDelete, onToggle, onCreateChild, onUnlink, onToggleFavorite, onToggleShare }: TreeRowProps) {
  const node = graph.nodes[nodeId];
  const [menuOpen, setMenuOpen] = useState(false);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("Note");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!node) return null;

  const childIds = (graph.edges[nodeId] ?? []).filter(id => graph.nodes[id]);
  const hasChildren = childIds.length > 0;
  const isExpanded = expanded.has(nodeId);
  const isFolder = node.kind.type === "Folder";
  const isFavorite = node.tags.includes("favorite");
  const isShared = node.team_id != null;

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(true);
    setChildName("");
    setChildKind("Note");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closeMenu() {
    setMenuOpen(false);
    setChildName("");
  }

  function handleCreate() {
    const name = childName.trim();
    if (!name) return;
    onCreateChild(nodeId, name, childKind);
    closeMenu();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") closeMenu();
  }

  function handleBlur(e: React.FocusEvent) {
    if (!menuRef.current?.contains(e.relatedTarget as Node)) {
      closeMenu();
    }
  }

  return (
    <>
      <li
        className={`tree-item ${nodeId === selectedId ? "active" : ""}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        <span className="tree-toggle" onClick={(e) => { e.stopPropagation(); hasChildren && onToggle(nodeId); }}>
          {hasChildren ? (isExpanded ? "▾" : "▸") : <span className="tree-dot">·</span>}
        </span>
        <span className="tree-label" onClick={() => onSelect(nodeId)}>
          {nodeIcon(node.kind)} {node.name}
        </span>
        <button className="node-menu-btn" onClick={openMenu} title="Add child node">⋯</button>
        {onToggleShare && (
          <button
            className={`share-btn${isShared ? " share-active" : ""}`}
            title={isShared
              ? (isFolder ? "Unshare this folder and everything in it" : "Unshare this note")
              : (isFolder ? "Share this folder and everything in it" : "Share this note")}
            onClick={(e) => { e.stopPropagation(); onToggleShare(nodeId, isShared); }}
          >⇄</button>
        )}
        {isFolder && onToggleFavorite && (
          <button
            className={`fav-btn${isFavorite ? " fav-active" : ""}`}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(nodeId, isFavorite); }}
          >★</button>
        )}
        {parentId && onUnlink && (
          <button className="unlink-btn" title="Remove connection to parent" onClick={(e) => { e.stopPropagation(); onUnlink(parentId, nodeId); }}>⊘</button>
        )}
        <button className="delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(nodeId); }}>×</button>
      </li>

      {menuOpen && (
        <li className="node-menu-row" style={{ paddingLeft: `${10 + depth * 14 + 18}px` }}>
          <div ref={menuRef} className="node-menu-dropdown" onBlur={handleBlur}>
            <div className="node-menu-create">
              <input
                ref={inputRef}
                className="node-menu-input"
                placeholder="Child name..."
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <select
                className="node-menu-select"
                value={childKind}
                onChange={(e) => setChildKind(e.target.value)}
              >
                <option>Note</option>
                <option>Folder</option>
                <option>Canvas</option>
                <option>CodeFile</option>
                <option>Table</option>
                <option>Database</option>
                <option>Workbook</option>
                <option>Reader</option>
                <option>Surface</option>
              </select>
              <button className="node-menu-add" onClick={handleCreate} disabled={!childName.trim()}>+</button>
            </div>

            {/* Touch-only mirror of the row's actions. Hidden by CSS on a
                pointer that can hover, where the row buttons are reachable
                without any of them appearing under a finger. */}
            <div className="node-menu-touch-actions">
              {onToggleShare && (
                <button
                  className="node-menu-action"
                  onClick={(e) => { e.stopPropagation(); closeMenu(); onToggleShare(nodeId, isShared); }}
                >⇄ {isShared ? "Unshare" : "Share"}</button>
              )}
              {isFolder && onToggleFavorite && (
                <button
                  className="node-menu-action"
                  onClick={(e) => { e.stopPropagation(); closeMenu(); onToggleFavorite(nodeId, isFavorite); }}
                >★ {isFavorite ? "Unfavorite" : "Favorite"}</button>
              )}
              {parentId && onUnlink && (
                <button
                  className="node-menu-action"
                  onClick={(e) => { e.stopPropagation(); closeMenu(); onUnlink(parentId, nodeId); }}
                >⊘ Unlink</button>
              )}
              <button
                className="node-menu-action node-menu-action-danger"
                onClick={(e) => { e.stopPropagation(); closeMenu(); onDelete(nodeId); }}
              >× Delete node</button>
            </div>
          </div>
        </li>
      )}

      {isExpanded && childIds.map(childId => (
        <TreeRow
          key={childId}
          nodeId={childId}
          graph={graph}
          selectedId={selectedId}
          expanded={expanded}
          depth={depth + 1}
          parentId={nodeId}
          onSelect={onSelect}
          onDelete={onDelete}
          onToggle={onToggle}
          onCreateChild={onCreateChild}
          onUnlink={onUnlink}
          onToggleFavorite={onToggleFavorite}
          onToggleShare={onToggleShare}
        />
      ))}
    </>
  );
}
