import { useCallback, useEffect, useState } from "react";
import { listTrash, TrashItem } from "../lib/api";
import { nodeIcon } from "../nodeUtils";

interface TrashPanelProps {
  // Both resolve AFTER the graph has been reloaded; the panel re-lists on
  // resolution. Confirmation for emptying lives in App, next to every other
  // destructive gate — the panel itself can start nothing destructive.
  onRestore: (id: string) => Promise<void>;
  onEmpty: () => Promise<void>;
}

export function TrashPanel({ onRestore, onEmpty }: TrashPanelProps) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listTrash());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  }

  if (error) return <div className="trash-empty" role="alert">{error}</div>;
  if (items === null) return <div className="trash-empty">Loading…</div>;
  if (items.length === 0) return <div className="trash-empty">The bin is empty.</div>;

  return (
    <div className="trash-panel">
      <div className="trash-header">
        <span>{items.length} in the bin</span>
        <button className="trash-empty-btn" onClick={() => act(onEmpty)}>Empty bin…</button>
      </div>
      <ul className="node-list trash-list">
        {items.map(item => (
          <li key={item.id} className="trash-item">
            <span className="trash-label" title={new Date(item.deleted_at).toLocaleString()}>
              {nodeIcon(item.kind)} {item.name}
            </span>
            <button
              className="trash-restore-btn"
              onClick={() => act(() => onRestore(item.id))}
            >Restore</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
