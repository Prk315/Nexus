import { useState } from "react";
import { VaultGraph } from "../types";
import { nodeIcon, kindColor } from "../nodeUtils";

interface HomePageProps {
  graph: VaultGraph;
  onSelectNode: (id: string) => void;
}

export function HomePage({ graph, onSelectNode }: HomePageProps) {
  const [search, setSearch]       = useState("");
  const [openFolder, setOpenFolder] = useState<string | null>(null);

  const q = search.toLowerCase().trim();

  // Left panel — Favorites: nodes tagged "favorite"
  const favorites = Object.values(graph.nodes)
    .filter(n => n.tags.includes("favorite"))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Left panel — Books: nodes tagged "book"
  const books = Object.values(graph.nodes)
    .filter(n => n.tags.includes("book"))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Main area: all folders, or contents of the open folder
  const allFolders = Object.values(graph.nodes)
    .filter(n => n.kind.type === "Folder")
    .filter(n => !q || n.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const folderChildren = openFolder
    ? (graph.edges[openFolder] ?? [])
        .map(id => graph.nodes[id])
        .filter(Boolean)
        .filter(n => !q || n.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className="home-page">
      <div className="home-layout">

        {/* ── Left sidebar ── */}
        <aside className="home-left">

          {/* Favorites */}
          <div className="home-panel">
            <div className="home-panel-title">Favorites</div>
            <div className="home-panel-body">
              {favorites.length === 0
                ? <span className="home-panel-empty">Tag a node ★ to pin it here</span>
                : favorites.map(n => (
                  <button key={n.id} className="home-panel-item" onClick={() => onSelectNode(n.id)}>
                    <span className="home-panel-item-icon" style={{ color: kindColor(n.kind) }}>{nodeIcon(n.kind)}</span>
                    <span className="home-panel-item-name">{n.name}</span>
                  </button>
                ))
              }
            </div>
          </div>

          {/* Books */}
          <div className="home-panel">
            <div className="home-panel-title">Books</div>
            <div className="home-panel-body">
              {books.length === 0
                ? <span className="home-panel-empty">Tag a node "book" to list it here</span>
                : books.map(n => (
                  <button key={n.id} className="home-panel-item" onClick={() => onSelectNode(n.id)}>
                    <span className="home-panel-item-icon" style={{ color: kindColor(n.kind) }}>{nodeIcon(n.kind)}</span>
                    <span className="home-panel-item-name">{n.name}</span>
                  </button>
                ))
              }
            </div>
          </div>

        </aside>

        {/* ── Main folder overview ── */}
        <main className="home-main">
          <div className="home-main-header">
            {openFolder ? (
              <div className="home-folder-breadcrumb">
                <button className="home-folder-back" onClick={() => setOpenFolder(null)}>‹ Folders</button>
                <span className="home-folder-breadcrumb-sep">/</span>
                <span className="home-folder-breadcrumb-name">{graph.nodes[openFolder]?.name}</span>
              </div>
            ) : (
              <span className="home-main-heading">Folders</span>
            )}
            <input
              className="home-search home-main-search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="home-notes-grid">
            {openFolder ? (
              folderChildren.length === 0
                ? <p className="home-notes-empty">This folder is empty.</p>
                : folderChildren.map(node => (
                  <button key={node.id} className="home-note-card"
                    onClick={() => node.kind.type === "Folder" ? setOpenFolder(node.id) : onSelectNode(node.id)}>
                    <span className="home-note-icon" style={{ color: kindColor(node.kind) }}>{nodeIcon(node.kind)}</span>
                    <span className="home-note-name">{node.name}</span>
                    {node.tags.filter(t => t !== "favorite" && t !== "book").length > 0 && (
                      <div className="home-note-tags">
                        {node.tags.filter(t => t !== "favorite" && t !== "book").map(tag => (
                          <span key={tag} className="home-note-tag"
                            style={graph.tag_colors[tag] ? { background: graph.tag_colors[tag] + "22", color: graph.tag_colors[tag] } : {}}
                          >{tag}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))
            ) : (
              allFolders.length === 0
                ? <p className="home-notes-empty">No folders yet.</p>
                : allFolders.map(node => (
                  <button key={node.id} className="home-note-card" onClick={() => setOpenFolder(node.id)}>
                    <span className="home-note-icon" style={{ color: kindColor(node.kind) }}>{nodeIcon(node.kind)}</span>
                    <span className="home-note-name">{node.name}</span>
                  </button>
                ))
            )}
          </div>
        </main>

      </div>
    </div>
  );
}
