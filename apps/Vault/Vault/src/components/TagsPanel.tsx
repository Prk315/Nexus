import { useState } from "react";
import type { VaultGraph } from "../types";

interface Props {
  graph: VaultGraph;
  onCreateTag: (tag: string, color: string) => Promise<void>;
  onRenameTag: (oldName: string, newName: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
  onSetTagColor: (tag: string, color: string) => void;
}

const DEFAULT_NEW_COLOR = "#6366f1";

export function TagsPanel({ graph, onCreateTag, onRenameTag, onDeleteTag, onSetTagColor }: Props) {
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(DEFAULT_NEW_COLOR);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // All tags: union of tag_colors keys and tags on nodes
  const allTags = Array.from(
    new Set([
      ...Object.keys(graph.tag_colors),
      ...Object.values(graph.nodes).flatMap(n => n.tags ?? []),
    ])
  ).sort();

  const nodeCountByTag: Record<string, number> = {};
  for (const node of Object.values(graph.nodes)) {
    for (const tag of node.tags ?? []) {
      nodeCountByTag[tag] = (nodeCountByTag[tag] ?? 0) + 1;
    }
  }

  async function handleCreate() {
    const name = newTagName.trim();
    if (!name) return;
    await onCreateTag(name, newTagColor);
    setNewTagName("");
    setNewTagColor(DEFAULT_NEW_COLOR);
  }

  function startRename(tag: string) {
    setRenamingTag(tag);
    setRenameValue(tag);
  }

  async function commitRename(tag: string) {
    const next = renameValue.trim();
    if (next && next !== tag) await onRenameTag(tag, next);
    setRenamingTag(null);
  }

  return (
    <div className="tags-panel">
      {/* ── Create ── */}
      <div className="tags-create-row">
        <input
          className="tags-create-input"
          placeholder="New tag name…"
          value={newTagName}
          onChange={e => setNewTagName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleCreate()}
        />
        <input
          type="color"
          className="tags-color-swatch"
          value={newTagColor}
          onChange={e => setNewTagColor(e.target.value)}
          title="Pick colour"
        />
        <button
          className="tags-create-btn"
          onClick={handleCreate}
          disabled={!newTagName.trim()}
        >+</button>
      </div>

      {/* ── Tag list ── */}
      {allTags.length === 0 ? (
        <div className="tags-empty">No tags yet</div>
      ) : (
        <ul className="tags-list">
          {allTags.map(tag => {
            const color = graph.tag_colors[tag] ?? "#94a3b8";
            const count = nodeCountByTag[tag] ?? 0;
            const isRenaming = renamingTag === tag;

            return (
              <li key={tag} className="tags-row">
                {/* Colour swatch */}
                <input
                  type="color"
                  className="tags-color-swatch"
                  value={color}
                  onChange={e => onSetTagColor(tag, e.target.value)}
                  title="Change colour"
                />

                {/* Name / rename input */}
                {isRenaming ? (
                  <input
                    className="tags-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(tag)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename(tag);
                      if (e.key === "Escape") setRenamingTag(null);
                    }}
                  />
                ) : (
                  <span
                    className="tags-name"
                    onClick={() => startRename(tag)}
                    title="Click to rename"
                  >{tag}</span>
                )}

                {/* Node count */}
                <span className="tags-count">{count}</span>

                {/* Delete */}
                <button
                  className="tags-delete-btn"
                  onClick={() => onDeleteTag(tag)}
                  title={`Delete "${tag}" from all nodes`}
                >×</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
