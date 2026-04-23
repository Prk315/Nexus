import { useRef, useEffect } from "react";
import { VaultNode } from "../types";
import { nodeIcon } from "../nodeUtils";

interface SearchModalProps {
  query: string;
  results: VaultNode[];
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SearchModal({ query, results, onQueryChange, onSelect, onClose }: SearchModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search nodes..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <ul className="search-results">
          {results.map(n => (
            <li key={n.id} onClick={() => onSelect(n.id)}>
              {nodeIcon(n.kind)} {n.name}
            </li>
          ))}
          {results.length === 0 && <li className="search-empty">No results</li>}
        </ul>
      </div>
    </div>
  );
}
