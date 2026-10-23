import { useMemo } from "react";
import { VaultGraph } from "../../types";
import { folderGraph, layoutRadial, projectIso } from "./subgraph";

// The folder map in the corner of the graph.
//
// No panel, no fill, no chrome: the folder nodes and their edges are drawn
// straight over the main graph and everything else is transparent. Reset lives
// in the graph bar's "All" chip, so the map does not need a button of its own.
//
// It is a FIXED camera over a deterministic layout (layoutRadial → projectIso),
// not a second ForceGraph3D. Two reasons, in order: the main graph beneath it is
// already a running simulation, so a map that also drifted would leave nothing
// on screen holding still; and a second WebGL context for decoration is exactly
// the cost — and the kapsule/layout race — that CLAUDE.md warns about. Depth is
// carried by size and opacity, which is all a 12px dot can carry anyway.

interface Props {
  graph: VaultGraph;
  /** The folder currently zoomed to, if any. */
  currentId: string | null;
  onPick: (folderId: string) => void;
  width?: number;
  height?: number;
}

export function Minimap({ graph, currentId, onPick, width = 150, height = 120 }: Props) {
  const { nodes, edges } = useMemo(() => {
    const sub = folderGraph(graph);
    const placed = layoutRadial(graph, sub);
    const at = new Map(
      placed.map((p) => [p.id, { ...projectIso(p, { width, height, pad: 12 }), depth: p.depth }]),
    );
    return {
      // Far first, so nearer folders draw over the ones behind them.
      nodes: placed
        .slice()
        .sort((a, b) => a.z - b.z)
        .map((p) => ({ id: p.id, ...at.get(p.id)! })),
      edges: sub.edges.filter(([a, b]) => at.has(a) && at.has(b)).map(([a, b]) => ({
        a,
        b,
        pa: at.get(a)!,
        pb: at.get(b)!,
      })),
    };
  }, [graph, width, height]);

  if (nodes.length === 0) return null;

  return (
    <svg className="dir-minimap" width={width} height={height} role="img" aria-label="Folder map">
      {edges.map(({ a, b, pa, pb }, i) => (
        <line
          key={`${a}->${b}-${i}`}
          className="dir-minimap-edge"
          x1={pa.x}
          y1={pa.y}
          x2={pb.x}
          y2={pb.y}
          // Edges recede with the pair's nearest end, so the far side of the
          // map reads as behind rather than as a tangle at equal weight.
          opacity={0.18 + Math.max(pa.near, pb.near) * 0.34}
        />
      ))}
      {nodes.map((n) => {
        const isCurrent = n.id === currentId;
        const r = (n.depth === 0 ? 3.6 : 2.4) + n.near * 1.6;
        return (
          <circle
            key={n.id}
            className={`dir-minimap-node${isCurrent ? " is-current" : ""}`}
            cx={n.x}
            cy={n.y}
            r={isCurrent ? r + 1.6 : r}
            opacity={isCurrent ? 1 : 0.4 + n.near * 0.5}
            onClick={(e) => {
              e.stopPropagation();
              onPick(n.id);
            }}
          >
            <title>{graph.nodes[n.id]?.name ?? n.id}</title>
          </circle>
        );
      })}
    </svg>
  );
}
