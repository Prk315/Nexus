import { VaultGraph } from "../types";
import { buildKind, kindColor } from "../nodeUtils";

export interface GraphFilters {
  query: string;
  hiddenKinds: Set<string>;
  tagFilter: Set<string>; // if non-empty, show only nodes with at least one of these tags
  showOrphans: boolean;
  gravity: number;          // 1–10, maps to D3 charge strength; default 5
  fontSize: number;         // label scale multiplier 0.5–2.0; default 1.0
  // Cluster settings (3D only)
  showClusters: boolean;
  clusterStrength: number;  // 0.01–0.5, default 0.08
  clusterOpacity: number;   // 0.01–0.5, default 0.09
  clusterPadding: number;   // 5–60 units, default 18
  clusterColor: string;     // "" = use per-tag colour, otherwise a hex override
  clusterRepulsion: number; // 0–600, default 200 — how hard clusters push each other apart
  clusterShowLabel: boolean;
  clusterFontSize: number;  // 8–32, default 14
}

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  query: "",
  hiddenKinds: new Set(),
  tagFilter: new Set(),
  showOrphans: true,
  gravity: 5,
  fontSize: 1.0,
  showClusters: true,
  clusterStrength: 0.08,
  clusterOpacity: 0.09,
  clusterPadding: 18,
  clusterColor: "",
  clusterRepulsion: 200,
  clusterShowLabel: true,
  clusterFontSize: 14,
};

export function isDefaultFilters(f: GraphFilters): boolean {
  return (
    f.query === "" &&
    f.hiddenKinds.size === 0 &&
    f.tagFilter.size === 0 &&
    f.showOrphans &&
    f.gravity === 5 &&
    f.fontSize === 1.0 &&
    f.showClusters &&
    f.clusterStrength === 0.08 &&
    f.clusterOpacity === 0.09 &&
    f.clusterPadding === 18 &&
    f.clusterColor === "" &&
    f.clusterRepulsion === 200 &&
    f.clusterShowLabel &&
    f.clusterFontSize === 14
  );
}

const ALL_KINDS = ["Note", "Folder", "Canvas", "CodeFile", "Table", "Database", "Pdf", "Video", "Journal"];

interface Props {
  graph: VaultGraph;
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
}

export function GraphFilterPanel({ graph, filters, onChange }: Props) {
  const allTags = Array.from(
    new Set(Object.values(graph.nodes).flatMap(n => n.tags ?? []))
  ).sort();

  function toggleKind(kind: string) {
    const next = new Set(filters.hiddenKinds);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    onChange({ ...filters, hiddenKinds: next });
  }

  function toggleTag(tag: string) {
    const next = new Set(filters.tagFilter);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    onChange({ ...filters, tagFilter: next });
  }

  function reset() {
    onChange({ ...DEFAULT_GRAPH_FILTERS });
  }

  return (
    <div className="graph-filter-panel">
      <div className="graph-filter-header">
        <span className="graph-filter-title">Graph settings</span>
        {!isDefaultFilters(filters) && (
          <button className="graph-filter-reset" onClick={reset}>Reset</button>
        )}
      </div>

      {/* ── Search ── */}
      <div className="graph-filter-section">
        <div className="graph-filter-label">Search</div>
        <input
          className="graph-filter-input"
          placeholder="Search nodes…"
          value={filters.query}
          onChange={e => onChange({ ...filters, query: e.target.value })}
          autoFocus={false}
        />
      </div>

      {/* ── Node types ── */}
      <div className="graph-filter-section">
        <div className="graph-filter-label">Node types</div>
        {ALL_KINDS.map(kind => (
          <label key={kind} className="graph-filter-check">
            <input
              type="checkbox"
              checked={!filters.hiddenKinds.has(kind)}
              onChange={() => toggleKind(kind)}
            />
            <span
              className="graph-filter-dot"
              style={{ background: kindColor(buildKind(kind)) }}
            />
            {kind}
          </label>
        ))}
      </div>

      {/* ── Tags ── */}
      {allTags.length > 0 && (
        <div className="graph-filter-section">
          <div className="graph-filter-label">
            Tags
            {filters.tagFilter.size > 0 && (
              <span className="graph-filter-badge">{filters.tagFilter.size} active</span>
            )}
          </div>
          {allTags.map(tag => (
            <label key={tag} className="graph-filter-check">
              <input
                type="checkbox"
                checked={filters.tagFilter.has(tag)}
                onChange={() => toggleTag(tag)}
              />
              <span
                className="graph-filter-dot"
                style={{ background: graph.tag_colors[tag] ?? "#94a3b8" }}
              />
              {tag}
            </label>
          ))}
          {filters.tagFilter.size > 0 && (
            <button
              className="graph-filter-clear"
              onClick={() => onChange({ ...filters, tagFilter: new Set() })}
            >
              Clear tag filter
            </button>
          )}
        </div>
      )}

      {/* ── Orphans ── */}
      <div className="graph-filter-section">
        <label className="graph-filter-check">
          <input
            type="checkbox"
            checked={filters.showOrphans}
            onChange={e => onChange({ ...filters, showOrphans: e.target.checked })}
          />
          Show orphans
        </label>
      </div>

      {/* ── Clusters (3D) ── */}
      <div className="graph-filter-section">
        <div className="graph-filter-label">
          Clusters <span style={{ fontSize: 10, color: "var(--fg-ghost)", fontWeight: 400 }}>3D</span>
        </div>
        <label className="graph-filter-check">
          <input
            type="checkbox"
            checked={filters.showClusters}
            onChange={e => onChange({ ...filters, showClusters: e.target.checked })}
          />
          Enable clusters
        </label>

        {filters.showClusters && (<>
          <div className="graph-filter-sub-label">Strength</div>
          <div className="graph-filter-slider-row">
            <span className="graph-filter-slider-cap">Low</span>
            <input type="range" min={0.01} max={0.5} step={0.01}
              value={filters.clusterStrength} className="graph-filter-slider"
              onChange={e => onChange({ ...filters, clusterStrength: Number(e.target.value) })} />
            <span className="graph-filter-slider-cap">High</span>
            <span className="graph-filter-slider-val">{filters.clusterStrength.toFixed(2)}</span>
          </div>

          <div className="graph-filter-sub-label">Opacity</div>
          <div className="graph-filter-slider-row">
            <span className="graph-filter-slider-cap">0</span>
            <input type="range" min={0.01} max={0.5} step={0.01}
              value={filters.clusterOpacity} className="graph-filter-slider"
              onChange={e => onChange({ ...filters, clusterOpacity: Number(e.target.value) })} />
            <span className="graph-filter-slider-cap">½</span>
            <span className="graph-filter-slider-val">{filters.clusterOpacity.toFixed(2)}</span>
          </div>

          <div className="graph-filter-sub-label">Padding</div>
          <div className="graph-filter-slider-row">
            <span className="graph-filter-slider-cap">S</span>
            <input type="range" min={5} max={60} step={1}
              value={filters.clusterPadding} className="graph-filter-slider"
              onChange={e => onChange({ ...filters, clusterPadding: Number(e.target.value) })} />
            <span className="graph-filter-slider-cap">L</span>
            <span className="graph-filter-slider-val">{filters.clusterPadding}px</span>
          </div>

          <div className="graph-filter-sub-label">Bubble colour</div>
          <div className="graph-filter-color-row">
            <label className="graph-filter-check" style={{ flex: 1 }}>
              <input type="checkbox" checked={filters.clusterColor === ""}
                onChange={e => onChange({ ...filters, clusterColor: e.target.checked ? "" : "#6366f1" })} />
              Per-tag colour
            </label>
            <input
              type="color"
              value={filters.clusterColor !== "" ? filters.clusterColor : "#6366f1"}
              className="graph-filter-color-swatch"
              style={{ opacity: filters.clusterColor === "" ? 0.35 : 1, pointerEvents: filters.clusterColor === "" ? "none" : "auto" }}
              onChange={e => onChange({ ...filters, clusterColor: e.target.value })}
            />
          </div>

          <div className="graph-filter-sub-label">Cluster repulsion</div>
          <div className="graph-filter-slider-row">
            <span className="graph-filter-slider-cap">Off</span>
            <input type="range" min={0} max={600} step={10}
              value={filters.clusterRepulsion} className="graph-filter-slider"
              onChange={e => onChange({ ...filters, clusterRepulsion: Number(e.target.value) })} />
            <span className="graph-filter-slider-cap">High</span>
            <span className="graph-filter-slider-val">{filters.clusterRepulsion}</span>
          </div>

          <label className="graph-filter-check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={filters.clusterShowLabel}
              onChange={e => onChange({ ...filters, clusterShowLabel: e.target.checked })} />
            Show label
          </label>

          {filters.clusterShowLabel && (<>
            <div className="graph-filter-sub-label">Label font size</div>
            <div className="graph-filter-slider-row">
              <span className="graph-filter-slider-cap">S</span>
              <input type="range" min={8} max={32} step={1}
                value={filters.clusterFontSize} className="graph-filter-slider"
                onChange={e => onChange({ ...filters, clusterFontSize: Number(e.target.value) })} />
              <span className="graph-filter-slider-cap">L</span>
              <span className="graph-filter-slider-val">{filters.clusterFontSize}px</span>
            </div>
          </>)}
        </>)}
      </div>

      {/* ── Physics ── */}
      <div className="graph-filter-section">
        <div className="graph-filter-label">Gravity</div>
        <div className="graph-filter-slider-row">
          <span className="graph-filter-slider-cap">Low</span>
          <input
            type="range"
            min={1} max={10} step={1}
            value={filters.gravity}
            onChange={e => onChange({ ...filters, gravity: Number(e.target.value) })}
            className="graph-filter-slider"
          />
          <span className="graph-filter-slider-cap">High</span>
          <span className="graph-filter-slider-val">{filters.gravity}</span>
        </div>
      </div>

      {/* ── Appearance ── */}
      <div className="graph-filter-section">
        <div className="graph-filter-label">Label size</div>
        <div className="graph-filter-slider-row">
          <span className="graph-filter-slider-cap">S</span>
          <input
            type="range"
            min={0.5} max={2.0} step={0.1}
            value={filters.fontSize}
            onChange={e => onChange({ ...filters, fontSize: Number(e.target.value) })}
            className="graph-filter-slider"
          />
          <span className="graph-filter-slider-cap">L</span>
          <span className="graph-filter-slider-val">{filters.fontSize.toFixed(1)}×</span>
        </div>
      </div>
    </div>
  );
}
