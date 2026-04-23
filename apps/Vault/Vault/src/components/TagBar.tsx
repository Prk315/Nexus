import { useState, useRef, useEffect } from "react";
import { VaultGraph } from "../types";

interface TagBarProps {
  nodeId: string;
  graph: VaultGraph;
  newTag: string;
  onNewTagChange: (val: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetTagColor: (tag: string, color: string) => void;
}

export function TagBar({ nodeId, graph, newTag, onNewTagChange, onAddTag, onRemoveTag }: TagBarProps) {
  const node = graph.nodes[nodeId];
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  if (!node) return null;

  const nodeTags = new Set(node.tags ?? []);

  // Include tags from tag_colors AND tags used on any node
  const allKnownTags = Array.from(new Set([
    ...Object.keys(graph.tag_colors),
    ...Object.values(graph.nodes).flatMap(n => n.tags ?? []),
  ]));

  const suggestions = allKnownTags
    .filter(t => !nodeTags.has(t) && t.toLowerCase().includes(newTag.toLowerCase().trim()))
    .sort();

  function updatePos() {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
  }

  function pick(tag: string) {
    onAddTag(tag);
    setOpen(false);
    setHighlighted(0);
    inputRef.current?.focus();
  }

  function handleAdd() {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    onAddTag(trimmed);
    setOpen(false);
    setHighlighted(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && suggestions.length > 0) {
        pick(suggestions[highlighted]);
      } else {
        handleAdd();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!inputRef.current?.contains(e.target as Node)) {
        const dropdown = document.getElementById("tag-dropdown-portal");
        if (!dropdown?.contains(e.target as Node)) setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => { setHighlighted(0); }, [newTag]);

  return (
    <div className="tag-bar">
      {(node.tags ?? []).map(tag => (
        <span key={tag} className="tag-chip" style={{ borderColor: graph.tag_colors[tag] ?? "#94a3b8" }}>
          <span className="tag-color-dot" style={{ background: graph.tag_colors[tag] ?? "#94a3b8" }} />
          #{tag}
          <button className="tag-remove" onClick={() => onRemoveTag(tag)}>×</button>
        </span>
      ))}

      <input
        ref={inputRef}
        className="tag-input"
        placeholder="+ tag"
        value={newTag}
        onChange={e => { onNewTagChange(e.target.value); setOpen(true); updatePos(); }}
        onFocus={() => { setOpen(true); updatePos(); }}
        onKeyDown={handleKeyDown}
      />

      {open && suggestions.length > 0 && (
        <div
          id="tag-dropdown-portal"
          className="tag-dropdown"
          style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width }}
        >
          {suggestions.map((t, i) => (
            <div
              key={t}
              className={`tag-dropdown-item${i === highlighted ? " highlighted" : ""}`}
              onPointerDown={e => { e.preventDefault(); pick(t); }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="tag-color-dot" style={{ background: graph.tag_colors[t] ?? "#94a3b8" }} />
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
