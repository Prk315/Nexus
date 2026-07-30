import { useMemo, useState } from "react";
import { VaultRecord } from "../types";

interface Props {
  records: VaultRecord[];
  dbName: string;
  onInsert: (recs: VaultRecord[]) => void;
  onClose: () => void;
}

// Modal picker: filter the ancestor database's records by category, select
// entries, and insert them into the current note at the cursor.
export function DatabaseInsertPicker({ records, dbName, onInsert, onClose }: Props) {
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.category, r.color);
    return [...map.entries()].map(([name, color]) => ({ name, color }));
  }, [records]);

  const visible = useMemo(
    () => (activeCat ? records.filter((r) => r.category === activeCat) : records),
    [records, activeCat]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function confirm() {
    const chosen = records.filter((r) => selected.has(r.id));
    onInsert(chosen.length ? chosen : visible);
  }

  return (
    <div className="db-picker-overlay" onClick={onClose}>
      <div className="db-picker" onClick={(e) => e.stopPropagation()}>
        <div className="db-picker-head">
          <span>Insert from <strong>{dbName}</strong></span>
          <button className="db-picker-close" onClick={onClose}>×</button>
        </div>

        {records.length === 0 ? (
          <div className="db-picker-empty">This database has no records yet.</div>
        ) : (
          <>
            <div className="db-picker-chips">
              <button
                className={`db-chip${activeCat === null ? " active" : ""}`}
                onClick={() => setActiveCat(null)}
              >
                All <span className="db-chip-count">{records.length}</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.name}
                  className={`db-chip${activeCat === c.name ? " active" : ""}`}
                  onClick={() => setActiveCat(activeCat === c.name ? null : c.name)}
                >
                  <span className="db-swatch" style={{ background: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>

            <div className="db-picker-list">
              {visible.map((r) => (
                <label className="db-picker-row" key={r.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="db-cat-badge" style={{ background: r.color }}>{r.category}</span>
                  <span className="db-picker-text">{r.text}</span>
                </label>
              ))}
            </div>

            <div className="db-picker-foot">
              <span className="db-picker-hint">
                {selected.size > 0 ? `${selected.size} selected` : "Nothing selected → inserts all shown"}
              </span>
              <button className="db-picker-insert" onClick={confirm}>Insert</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
