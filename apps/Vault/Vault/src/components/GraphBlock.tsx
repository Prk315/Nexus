import { useRef, useState } from "react";

// ── Public types ──────────────────────────────────────────────────────────────
export interface GNode { id: string; x: number; y: number; label: string; }
export interface GEdge { id: string; from: string; to: string; weight: string; }

export interface GraphBlockData {
  id: string;
  type: "graph_theory";
  x: number; y: number; width: number; height: number;
  nodes: GNode[];
  edges: GEdge[];
  directed: boolean;
  weighted: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_R  = 20;   // visual radius
const HIT_R   = 24;   // hit-test radius
const EDGE_HIT = 8;   // px from line to count as hit

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  block: GraphBlockData;
  onPatch: (p: Partial<GraphBlockData>) => void;
  onSelect?: () => void;
}

type Tool = "select" | "connect";
type SelTarget = { type: "node" | "edge"; id: string } | null;

export function GraphBlockContent({ block, onPatch, onSelect }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ nodeId: string; initNx: number; initNy: number; initMx: number; initMy: number } | null>(null);
  const downRef = useRef<{ x: number; y: number; hitNode: boolean; hitEdge: boolean } | null>(null);

  const [tool,       setTool]       = useState<Tool>("select");
  const [sel,        setSel]        = useState<SelTarget>(null);
  const [ghost,      setGhost]      = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [editNode,   setEditNode]   = useState<string | null>(null);
  const [editEdge,   setEditEdge]   = useState<string | null>(null);
  const [editVal,    setEditVal]    = useState("");

  const { nodes, edges, directed, weighted } = block;

  // ── Geometry helpers ────────────────────────────────────────────────────────
  function svgPt(e: React.MouseEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitNode(x: number, y: number) {
    return nodes.find(n => Math.hypot(n.x - x, n.y - y) <= HIT_R) ?? null;
  }

  function hitEdge(x: number, y: number) {
    for (const e of edges) {
      const A = nodes.find(n => n.id === e.from);
      const B = nodes.find(n => n.id === e.to);
      if (!A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / len2));
      const dist = Math.hypot(A.x + t * dx - x, A.y + t * dy - y);
      if (dist <= EDGE_HIT) return e;
    }
    return null;
  }

  function nextLabel() {
    const used = new Set(nodes.map(n => n.label));
    for (let i = 0; i < 26; i++) {
      const l = String.fromCharCode(65 + i);
      if (!used.has(l)) return l;
    }
    for (let i = 1; i <= 999; i++) {
      if (!used.has(String(i))) return String(i);
    }
    return String(nodes.length + 1);
  }

  // ── Edge geometry ───────────────────────────────────────────────────────────
  interface EdgeGeom {
    x1: number; y1: number; x2: number; y2: number;
    mx: number; my: number;
    d: string; // SVG path
  }

  function edgeGeom(e: GEdge): EdgeGeom | null {
    const A = nodes.find(n => n.id === e.from);
    const B = nodes.find(n => n.id === e.to);
    if (!A || !B) return null;

    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len;

    // Shorten to node border (+ arrow gap when directed)
    const tailGap = NODE_R;
    const headGap = NODE_R + (directed ? 7 : 0);
    const x1 = A.x + ux * tailGap;
    const y1 = A.y + uy * tailGap;
    const x2 = B.x - ux * headGap;
    const y2 = B.y - uy * headGap;

    // Curve if anti-parallel edge exists (directed only)
    const hasAnti = directed && edges.some(r => r.from === e.to && r.to === e.from);
    if (hasAnti) {
      const px = -uy * 18, py = ux * 18;
      const cx = (x1 + x2) / 2 + px, cy = (y1 + y2) / 2 + py;
      return {
        x1, y1, x2, y2,
        mx: cx, my: cy,
        d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,
      };
    }

    return {
      x1, y1, x2, y2,
      mx: (x1 + x2) / 2,
      my: (y1 + y2) / 2,
      d: `M${x1},${y1} L${x2},${y2}`,
    };
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function deleteSelected() {
    if (!sel) return;
    if (sel.type === "node") {
      onPatch({
        nodes: nodes.filter(n => n.id !== sel.id),
        edges: edges.filter(e => e.from !== sel.id && e.to !== sel.id),
      });
    } else {
      onPatch({ edges: edges.filter(e => e.id !== sel.id) });
    }
    setSel(null);
  }

  function commitNodeEdit() {
    if (!editNode) return;
    onPatch({ nodes: nodes.map(n => n.id === editNode ? { ...n, label: editVal.trim() || n.label } : n) });
    setEditNode(null);
  }

  function commitEdgeEdit() {
    if (!editEdge) return;
    onPatch({ edges: edges.map(e => e.id === editEdge ? { ...e, weight: editVal.trim() || e.weight } : e) });
    setEditEdge(null);
  }

  function commitAnyEdit() { commitNodeEdit(); commitEdgeEdit(); }

  function startEdgeEdit(edgeId: string) {
    const e = edges.find(x => x.id === edgeId);
    if (!e) return;
    setEditEdge(edgeId);
    setEditVal(e.weight);
    setEditNode(null);
  }

  function startNodeEdit(nodeId: string) {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    setEditNode(nodeId);
    setEditVal(n.label);
    setEditEdge(null);
  }

  // ── SVG event handlers ──────────────────────────────────────────────────────
  function onSvgDown(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect?.();
    commitAnyEdit();

    const pt = svgPt(e);
    const node = hitNode(pt.x, pt.y);
    const edge = node ? null : hitEdge(pt.x, pt.y);

    downRef.current = { x: pt.x, y: pt.y, hitNode: !!node, hitEdge: !!edge };

    if (tool === "select") {
      if (node) {
        setSel({ type: "node", id: node.id });
        dragRef.current = { nodeId: node.id, initNx: node.x, initNy: node.y, initMx: pt.x, initMy: pt.y };
      } else if (edge) {
        setSel({ type: "edge", id: edge.id });
      } else {
        setSel(null);
      }
    } else {
      // connect mode: start ghost from node
      if (node) {
        setGhost({ fromId: node.id, x: pt.x, y: pt.y });
      }
    }
  }

  function onSvgMove(e: React.MouseEvent) {
    const pt = svgPt(e);

    if (dragRef.current) {
      const { nodeId, initNx, initNy, initMx, initMy } = dragRef.current;
      onPatch({
        nodes: nodes.map(n =>
          n.id === nodeId ? { ...n, x: initNx + pt.x - initMx, y: initNy + pt.y - initMy } : n
        ),
      });
    }

    if (ghost) setGhost(g => g ? { ...g, x: pt.x, y: pt.y } : null);
  }

  function onSvgUp(e: React.MouseEvent) {
    const pt = svgPt(e);
    const wasDrag = downRef.current
      ? Math.hypot(pt.x - downRef.current.x, pt.y - downRef.current.y) > 5
      : false;

    // Finish node drag
    dragRef.current = null;

    // Finish edge draw
    if (ghost) {
      const target = hitNode(pt.x, pt.y);
      if (target && target.id !== ghost.fromId) {
        const fromId = ghost.fromId, toId = target.id;
        const dup = directed
          ? edges.some(x => x.from === fromId && x.to === toId)
          : edges.some(x => (x.from === fromId && x.to === toId) || (x.from === toId && x.to === fromId));
        if (!dup) {
          onPatch({ edges: [...edges, { id: crypto.randomUUID(), from: fromId, to: toId, weight: "1" }] });
        }
      }
      setGhost(null);
      downRef.current = null;
      return;
    }

    // Click on empty space in select mode → add node
    if (tool === "select" && !wasDrag && downRef.current && !downRef.current.hitNode && !downRef.current.hitEdge) {
      onPatch({ nodes: [...nodes, { id: crypto.randomUUID(), x: pt.x, y: pt.y, label: nextLabel() }] });
      setSel(null);
    }

    downRef.current = null;
  }

  function onSvgLeave() {
    dragRef.current = null;
    setGhost(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const TOOLBAR_H = 40;
  const svgH = Math.max(60, block.height - TOOLBAR_H - 2);
  const arrowId     = `gb-arr-${block.id}`;
  const arrowSelId  = `gb-arr-sel-${block.id}`;

  return (
    <div
      className="gb-root"
      onMouseDown={e => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* Toolbar */}
      <div className="gb-toolbar">
        <button
          className={`gb-tool${tool === "select" ? " gb-tool-active" : ""}`}
          onClick={() => { setTool("select"); setGhost(null); }}
          title="Select & move. Click empty canvas to add node."
        >↖ Select</button>
        <button
          className={`gb-tool${tool === "connect" ? " gb-tool-active" : ""}`}
          onClick={() => setTool("connect")}
          title="Drag from node to node to draw edge"
        >⟶ Connect</button>
        <div className="gb-toolbar-sep" />
        <label className="gb-chk-label" title="Directed graph (arrows)">
          <input type="checkbox" checked={directed} onMouseDown={e => e.stopPropagation()}
            onChange={e => onPatch({ directed: e.target.checked })} />
          Directed
        </label>
        <label className="gb-chk-label" title="Show edge weights (double-click edge to edit)">
          <input type="checkbox" checked={weighted} onMouseDown={e => e.stopPropagation()}
            onChange={e => onPatch({ weighted: e.target.checked })} />
          Weighted
        </label>
        <div style={{ flex: 1 }} />
        {sel && (
          <button className="gb-del-btn" onClick={deleteSelected}>
            × {sel.type === "node" ? "Node" : "Edge"}
          </button>
        )}
      </div>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        className={`gb-svg${tool === "connect" ? " gb-connect-cursor" : ""}`}
        width={block.width - 2}
        height={svgH}
        onMouseDown={onSvgDown}
        onMouseMove={onSvgMove}
        onMouseUp={onSvgUp}
        onMouseLeave={onSvgLeave}
      >
        <defs>
          <marker id={arrowId}    markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L10,3.5 z" fill="#64748b" />
          </marker>
          <marker id={arrowSelId} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L10,3.5 z" fill="#3b82f6" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map(e => {
          const g = edgeGeom(e);
          if (!g) return null;
          const isSel = sel?.type === "edge" && sel.id === e.id;
          const stroke = isSel ? "#3b82f6" : "#64748b";
          const mkr = directed ? `url(#${isSel ? arrowSelId : arrowId})` : undefined;

          return (
            <g key={e.id}>
              {/* Visible edge */}
              <path d={g.d} stroke={stroke} strokeWidth={isSel ? 2.5 : 1.8}
                fill="none" markerEnd={mkr} style={{ pointerEvents: "none" }} />
              {/* Wide invisible hit area */}
              <path
                d={g.d} stroke="transparent" strokeWidth={14} fill="none"
                style={{ cursor: "pointer" }}
                onMouseDown={ev => { ev.stopPropagation(); setSel({ type: "edge", id: e.id }); downRef.current = { x: 0, y: 0, hitEdge: true, hitNode: false }; }}
                onDoubleClick={ev => { ev.stopPropagation(); if (weighted) startEdgeEdit(e.id); }}
              />
              {/* Edge weight label */}
              {weighted && editEdge !== e.id && (
                <text x={g.mx} y={g.my - 7} textAnchor="middle" className="gb-edge-lbl"
                  onDoubleClick={ev => { ev.stopPropagation(); startEdgeEdit(e.id); }}>
                  {e.weight}
                </text>
              )}
              {/* Edge weight input */}
              {weighted && editEdge === e.id && (
                <foreignObject x={g.mx - 24} y={g.my - 22} width={48} height={20}>
                  <input
                    className="gb-inline-input"
                    value={editVal}
                    autoFocus
                    onChange={ev => setEditVal(ev.target.value)}
                    onKeyDown={ev => { if (ev.key === "Enter" || ev.key === "Escape") commitEdgeEdit(); ev.stopPropagation(); }}
                    onBlur={commitEdgeEdit}
                    onMouseDown={ev => ev.stopPropagation()}
                  />
                </foreignObject>
              )}
            </g>
          );
        })}

        {/* Ghost edge while connecting */}
        {ghost && (() => {
          const src = nodes.find(n => n.id === ghost.fromId);
          if (!src) return null;
          return (
            <line x1={src.x} y1={src.y} x2={ghost.x} y2={ghost.y}
              stroke="#3b82f6" strokeWidth={1.8} strokeDasharray="6,3"
              style={{ pointerEvents: "none" }} />
          );
        })()}

        {/* Nodes */}
        {nodes.map(n => {
          const isSel = sel?.type === "node" && sel.id === n.id;
          return (
            <g key={n.id} style={{ cursor: tool === "connect" ? "crosshair" : "move" }}>
              <circle cx={n.x} cy={n.y} r={NODE_R}
                fill={isSel ? "#dbeafe" : "var(--bg-base, #fff)"}
                stroke={isSel ? "#3b82f6" : "#475569"}
                strokeWidth={isSel ? 2.5 : 1.8}
              />
              {editNode !== n.id && (
                <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central"
                  className="gb-node-lbl"
                  onDoubleClick={ev => { ev.stopPropagation(); startNodeEdit(n.id); }}
                  style={{ pointerEvents: "none" }}
                >
                  {n.label}
                </text>
              )}
              {editNode === n.id && (
                <foreignObject x={n.x - NODE_R + 3} y={n.y - 11} width={NODE_R * 2 - 6} height={22}>
                  <input
                    className="gb-inline-input gb-inline-input-center"
                    value={editVal}
                    autoFocus
                    onChange={ev => setEditVal(ev.target.value)}
                    onKeyDown={ev => { if (ev.key === "Enter" || ev.key === "Escape") commitNodeEdit(); ev.stopPropagation(); }}
                    onBlur={commitNodeEdit}
                    onMouseDown={ev => ev.stopPropagation()}
                  />
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hint */}
      <div className="gb-hint">
        {tool === "select"
          ? "Click canvas → add node · Drag node → move · Double-click label → rename · Click edge/node + Delete btn"
          : "Drag from node to node → add edge · Double-click weight to edit"}
      </div>
    </div>
  );
}
