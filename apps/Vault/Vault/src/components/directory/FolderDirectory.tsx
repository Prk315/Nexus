import { useMemo } from "react";
import { VaultGraph } from "../../types";
import { breadcrumb } from "./subgraph";
import { childIdsOf, rootNodeIds } from "./treeFlatten";
import { isFolder, kindLabel, safeIcon } from "./nodeMeta";

// The Finder pane along the bottom of the grid: where you are, and what is in
// here. Selecting a folder tile drives the graph as well, so the two halves of
// the main area are one surface rather than two.

interface Props {
  graph: VaultGraph;
  /** null = the top of the vault, whose "children" are the root nodes. */
  folderId: string | null;
  selectedId: string | null;
  onOpenFolder: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export function FolderDirectory({ graph, folderId, selectedId, onOpenFolder, onSelect }: Props) {
  const crumbs = useMemo(
    () => (folderId ? breadcrumb(graph, folderId) : []),
    [graph, folderId],
  );
  const children = useMemo(
    () => (folderId ? childIdsOf(graph, folderId) : rootNodeIds(graph)),
    [graph, folderId],
  );

  return (
    <section className="dir-folders" aria-label="Folder contents">
      <div className="dir-crumbs">
        <button
          className={`dir-crumb${folderId === null ? " is-current" : ""}`}
          onClick={() => onOpenFolder(null)}
        >
          Vault
        </button>
        {crumbs.map((id, i) => (
          <span key={id} className="dir-crumb-wrap">
            <span className="dir-crumb-sep">/</span>
            <button
              className={`dir-crumb${i === crumbs.length - 1 ? " is-current" : ""}`}
              onClick={() => onOpenFolder(id)}
            >
              {graph.nodes[id]?.name ?? "—"}
            </button>
          </span>
        ))}
        <span className="dir-crumb-count">
          {children.length} item{children.length === 1 ? "" : "s"}
        </span>
      </div>

      {children.length === 0 ? (
        <div className="dir-tiles-empty">This folder is empty.</div>
      ) : (
        <div className="dir-tiles">
          {children.map((id) => {
            const node = graph.nodes[id];
            if (!node) return null;
            const folder = isFolder(node.kind);
            const count = childIdsOf(graph, id).length;
            return (
              <button
                key={id}
                className={`dir-tile${id === selectedId ? " is-selected" : ""}${folder ? " is-folder" : ""}`}
                title={kindLabel(node.kind)}
                onClick={() => {
                  onSelect(id);
                  if (folder) onOpenFolder(id);
                }}
              >
                <span className="dir-tile-icon">{safeIcon(node.kind)}</span>
                <span className="dir-tile-name">{node.name}</span>
                <span className="dir-tile-meta">
                  {folder ? `${count} item${count === 1 ? "" : "s"}` : kindLabel(node.kind)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
