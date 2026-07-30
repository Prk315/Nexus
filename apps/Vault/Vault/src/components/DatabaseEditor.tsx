import { useEffect, useMemo, useState } from "react";
import { VaultGraph, VaultRecord } from "../types";
import * as api from "../lib/api";
import { getDescendants } from "../nodeUtils";

interface Props {
  nodeId: string;
  graph: VaultGraph;
  onOpenNode: (id: string) => void;
}

// Aggregation view for a Database node: shows every highlight record recorded
// on any node in this node's subtree (itself → last vertices), filterable by
// category and free-text search. Records are attached to their source node;
// this view is a lens over graph.edges downward (see getDescendants).
export function DatabaseEditor({ nodeId, graph, onOpenNode }: Props) {
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Descendant source ids — recomputed when the graph topology below us changes.
  const sources = useMemo(() => getDescendants(graph, nodeId), [graph, nodeId]);
  const sourcesKey = sources.join(",");

  async function reload() {
    setLoading(true);
    try {
      setRecords(await api.readRecordsForSources(sources));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey]);

  // Category → color (last seen wins), for the filter chips.
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.category, r.color);
    return [...map.entries()].map(([name, color]) => ({ name, color }));
  }, [records]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (activeCat && r.category !== activeCat) return false;
      if (q && !r.text.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [records, activeCat, query]);

  async function handleDelete(id: string) {
    await api.deleteRecord(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  const nodeName = (id: string) => graph.nodes[id]?.name ?? "(deleted)";

  return (
    <div className="db-editor">
      <div className="db-toolbar">
        <div className="db-chips">
          <button
            className={`db-chip${activeCat === null ? " active" : ""}`}
            onClick={() => setActiveCat(null)}
          >
            All <span className="db-chip-count">{records.length}</span>
          </button>
          {categories.map((c) => {
            const count = records.filter((r) => r.category === c.name).length;
            return (
              <button
                key={c.name}
                className={`db-chip${activeCat === c.name ? " active" : ""}`}
                onClick={() => setActiveCat(activeCat === c.name ? null : c.name)}
              >
                <span className="db-swatch" style={{ background: c.color }} />
                {c.name} <span className="db-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        <input
          className="db-search"
          placeholder="Search records…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="db-refresh" onClick={reload} title="Reload records" disabled={loading}>
          ⟳
        </button>
      </div>

      {loading ? (
        <div className="db-empty">Loading…</div>
      ) : records.length === 0 ? (
        <div className="db-empty">
          No records yet. Highlight text with a category in any PDF or note below this
          database to record entries here.
        </div>
      ) : visible.length === 0 ? (
        <div className="db-empty">No records match this filter.</div>
      ) : (
        <div className="db-table-scroll">
          <table className="db-table">
            <thead>
              <tr>
                <th style={{ width: "12%" }}>Category</th>
                <th>Text</th>
                <th style={{ width: "16%" }}>Source</th>
                <th style={{ width: "8%" }}>Loc</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="db-cat-badge" style={{ background: r.color }}>
                      {r.category}
                    </span>
                  </td>
                  <td className="db-text-cell">{r.text}</td>
                  <td>
                    <button className="db-source-link" onClick={() => onOpenNode(r.source_node_id)}>
                      {nodeName(r.source_node_id)}
                    </button>
                  </td>
                  <td className="db-loc-cell">{r.location}</td>
                  <td>
                    <button
                      className="db-row-del"
                      title="Delete record"
                      onClick={() => handleDelete(r.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
