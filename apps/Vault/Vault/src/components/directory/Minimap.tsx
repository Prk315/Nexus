import { useMemo } from "react";
import { VaultGraph } from "../../types";
import { folderGraph, layoutRadial } from "./subgraph";

// The folder map in the corner of the graph.
//
// Precomputed from the graph and laid out deterministically (layoutRadial) —
// no simulation. A minimap that drifts is not a map, and this one exists to be
// the same picture every time you glance at it.

interface Props {
  graph: VaultGraph;
  /** The folder currently zoomed to, if any. */
  currentId: string | null;
  onPick: (folderId: string) => void;
  onReset: () => void;
  width?: number;
  height?: number;
}

export function Minimap({ graph, currentId, onPick, onReset, width = 168, height = 132 }: Props) {
  const { placed, edges, names } = useMemo(() => {
    const sub = folderGraph(graph);
    const layout = layoutRadial(graph, sub);
    const at = new Map(layout.map((p) => [p.id, p]));
    return {
      placed: layout,
      edges: sub.edges.filter(([a, b]) => at.has(a) && at.has(b)),
      names: at,
    };
  }, [graph]);

  if (placed.length === 0) return null;

  const px = (v: number, span: number, pad: number) => pad + v * (span - pad * 2);
  const pad = 12;

  return (
    <div className="dir-minimap" aria-label="Folder map">
      <div className="dir-minimap-head">
        <span>Folders</span>
        <button className="dir-minimap-reset" onClick={onReset} title="Show the whole vault">
          all
        </button>
      </div>
      <svg width={width} height={height} role="img">
        {edges.map(([a, b], i) => {
          const pa = names.get(a)!;
          const pb = names.get(b)!;
          return (
            <line
              key={`${a}->${b}-${i}`}
              className="dir-minimap-edge"
              x1={px(pa.x, width, pad)}
              y1={px(pa.y, height, pad)}
              x2={px(pb.x, width, pad)}
              y2={px(pb.y, height, pad)}
            />
          );
        })}
        {placed.map((p) => {
          const node = graph.nodes[p.id];
          const isCurrent = p.id === currentId;
          return (
            <circle
              key={p.id}
              className={`dir-minimap-node${isCurrent ? " is-current" : ""}`}
              cx={px(p.x, width, pad)}
              cy={px(p.y, height, pad)}
              r={p.depth === 0 ? 5 : isCurrent ? 5 : 3.5}
              onClick={(e) => {
                e.stopPropagation();
                onPick(p.id);
              }}
            >
              <title>{node?.name ?? p.id}</title>
            </circle>
          );
        })}
      </svg>
      <div className="dir-minimap-caption">
        {currentId ? graph.nodes[currentId]?.name ?? "—" : "whole vault"}
      </div>
    </div>
  );
}
