// Learn & Retain v2 — node inspector (P1, read-only).
// Right-side glass panel over the map. Everything here reads the same
// LearnNode objects the simulation owns (graph.byId holds live references,
// never copies) — no cloning, no writes.
import { useEffect, useMemo, useState } from "react";
import type { LearnGraph, LearnNode } from "./data";
import { LR, courseHue, heatColor, mixHex } from "./palette";

export interface InspectorPanelProps {
  node: LearnNode;
  graph: LearnGraph;
  /** Click a prereq/unlock → select it. Selection stays in LearnMode. */
  onNavigate: (conceptId: string) => void;
  onClose: () => void;
}

const UNLOCKS_COLLAPSE_AT = 12;

/** Same fill the map's mastery lens uses — the inspector and the map must
 *  agree on what a colour claims. */
function masteryColor(n: LearnNode): string {
  return n.mastery == null ? LR.inert : mixHex(LR.slate, courseHue(n.courseId), n.mastery);
}

/** "3d ago" / "5h ago" / "12m ago" — heat near zero must read as *decay*,
 *  not missing data, and the when is what makes that legible. */
function relTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact numeric formatting for α/β/heat readouts: at most 1 decimal,
 *  trailing .0 dropped. */
function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function resolve(ids: string[], graph: LearnGraph): LearnNode[] {
  const out: LearnNode[] = [];
  for (const id of ids) {
    const n = graph.byId.get(id);
    if (n) out.push(n); // skip misses silently — FKs make them impossible today
  }
  return out;
}

interface NeighborListProps {
  header: string;
  headerColor: string;
  nodes: LearnNode[];
  collapse: boolean;
  onNavigate: (conceptId: string) => void;
}

function NeighborList({ header, headerColor, nodes, collapse, onNavigate }: NeighborListProps) {
  const [showAll, setShowAll] = useState(false);
  if (nodes.length === 0) return null;
  const collapsed = collapse && !showAll && nodes.length > UNLOCKS_COLLAPSE_AT;
  const shown = collapsed ? nodes.slice(0, UNLOCKS_COLLAPSE_AT) : nodes;
  return (
    <div className="learn-insp-section">
      <div className="learn-insp-header" style={{ color: headerColor }}>
        {header} · {nodes.length}
      </div>
      {shown.map((n) => (
        <button
          key={n.id}
          className="learn-neighbor"
          style={{ borderLeftColor: courseHue(n.courseId) }}
          title={n.title}
          onClick={() => onNavigate(n.id)}
        >
          <span className="learn-neighbor-dot" style={{ background: masteryColor(n) }} />
          <span className="learn-neighbor-title">{n.title}</span>
        </button>
      ))}
      {collapsed && (
        <button className="learn-show-all" onClick={() => setShowAll(true)}>
          show all {nodes.length}
        </button>
      )}
    </div>
  );
}

export function InspectorPanel({ node, graph, onNavigate, onClose }: InspectorPanelProps) {
  // Re-collapse the unlocks list whenever the inspected node changes.
  const [listKey, setListKey] = useState(node.id);
  useEffect(() => setListKey(node.id), [node.id]);

  const now = useMemo(() => new Date(), [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const course = graph.courses.find((c) => c.cId === node.courseId) ?? null;
  const prereqs = useMemo(() => resolve(node.prereqIds, graph), [node, graph]);
  const unlocks = useMemo(() => resolve(node.unlockIds, graph), [node, graph]);

  // kind is NULL on 1043/1067 rows — fall back to role, then "concept".
  const kindBadge = node.kind ?? node.role ?? "concept";
  // Separate `intuition` badge (36 nodes) — but never duplicate the first
  // badge when the fallback already rendered "intuition".
  const showIntuition = node.role === "intuition" && kindBadge !== "intuition";

  // The data contract carries the derived pair (mean, confidence); recover
  // Beta parameters from them for display: α = mean·(α+β), β = (α+β) − α.
  const conf = node.confidence;
  const alpha = node.mastery != null && conf != null ? node.mastery * conf : null;
  const beta = alpha != null && conf != null ? conf - alpha : null;

  const hue = courseHue(node.courseId);

  return (
    <div className="learn-inspector">
      <button className="learn-insp-close" title="Close (Esc)" onClick={onClose}>
        ×
      </button>

      <div className="learn-insp-title">{node.title}</div>

      <div className="learn-insp-badges">
        <span className="learn-badge">{kindBadge}</span>
        {showIntuition && <span className="learn-badge learn-badge-intuition">intuition</span>}
        {node.retained && <span className="learn-badge learn-badge-retained">retained</span>}
      </div>

      <div className="learn-insp-course">
        <span style={{ color: hue }}>{course?.title ?? "Unknown course"}</span>
        {node.topicTitle && (
          <>
            <span className="learn-insp-sep"> · </span>
            <span className="learn-insp-topic">{node.topicTitle}</span>
          </>
        )}
      </div>

      <div className="learn-insp-readouts">
        {/* Mastery — null means never practiced, which is a different fact
            from "practiced and scored 0". Never render an empty bar for it. */}
        <div className="learn-readout">
          <div className="learn-readout-label">
            <span>Mastery</span>
            {node.mastery == null ? (
              <span className="learn-readout-dim">Not yet practiced</span>
            ) : (
              <span>
                {(node.mastery * 100).toFixed(0)}%
                {node.stable && <span className="learn-stable"> stable ✓</span>}
              </span>
            )}
          </div>
          {node.mastery != null && (
            <>
              <div className="learn-bar">
                <div
                  className="learn-bar-fill"
                  style={{
                    width: `${node.mastery * 100}%`,
                    background: masteryColor(node),
                  }}
                />
              </div>
              <div className="learn-readout-sub">
                α {alpha != null ? fmtNum(alpha) : "—"} · β {beta != null ? fmtNum(beta) : "—"} ·{" "}
                {conf != null ? fmtNum(conf) : "—"} attempts
              </div>
            </>
          )}
        </div>

        {/* Heat — decayed live to graph.loadedAt. The stored + last-reviewed
            sub-line is what makes a near-zero value read as decay. */}
        <div className="learn-readout">
          <div className="learn-readout-label">
            <span>Heat</span>
            <span>{(node.heatNow * 100).toFixed(0)}%</span>
          </div>
          <div className="learn-bar">
            <div
              className="learn-bar-fill"
              style={{
                width: `${Math.min(100, node.heatNow * 100)}%`,
                background: heatColor(node.heatNow),
              }}
            />
          </div>
          <div className="learn-readout-sub">
            {node.heatStored != null ? `stored ${node.heatStored.toFixed(2)}` : "no state"}
            {node.lastReviewed && ` · last reviewed ${relTime(node.lastReviewed, now)}`}
          </div>
        </div>

        {/* Importance — the percentile is the readable half; raw PageRank
            alone is meaningless at a p50 of 0.033. */}
        <div className="learn-readout">
          <div className="learn-readout-label">
            <span>Importance</span>
            <span>{node.importance.toFixed(3)}</span>
          </div>
          <div className="learn-bar">
            <div
              className="learn-bar-fill"
              style={{ width: `${node.importancePct}%`, background: hue }}
            />
          </div>
          <div className="learn-readout-sub">
            top {(100 - node.importancePct).toFixed(0)}% in {course?.title ?? "its course"}
          </div>
        </div>
      </div>

      {node.description && <div className="learn-insp-desc">{node.description}</div>}

      {node.proof && (
        <details className="learn-proof" style={{ borderLeftColor: hue }}>
          <summary>Proof</summary>
          <div className="learn-proof-body">{node.proof}</div>
        </details>
      )}

      <NeighborList
        key={`p-${listKey}`}
        header="PREREQUISITES"
        headerColor={LR.linkPrereq}
        nodes={prereqs}
        collapse={false}
        onNavigate={onNavigate}
      />
      <NeighborList
        key={`u-${listKey}`}
        header="UNLOCKS"
        headerColor={LR.linkUnlock}
        nodes={unlocks}
        collapse
        onNavigate={onNavigate}
      />

      {/* The join key to everything in NexusLocal — worth being able to copy. */}
      <div className="learn-insp-id">{node.id}</div>
    </div>
  );
}
