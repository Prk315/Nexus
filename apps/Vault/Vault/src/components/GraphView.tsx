import { useRef, useState, useEffect } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { VaultGraph } from "../types";
import { drawNode } from "../canvas/drawNode";
import { ClusterCircle, hitTestClusters, tagClusters } from "./directory/clusters";

interface GraphViewProps {
  graph: VaultGraph;
  graphData: { nodes: any[]; links: any[] };
  selectedId: string | null;
  linkMode: boolean;
  linkSource: string | null;
  width: number;
  height: number;
  onNodeClick: (id: string) => void;
  onEngineStop: () => void;
  onToggleLinkMode: () => void;
  hideToolbar?: boolean;
  onCreateNode?: (name: string, kind: string) => void;
  onDeleteNode?: (id: string) => void;
  onDeleteEdge?: (fromId: string, toId: string) => void;

  // ── Directory prototype (all optional; the sidebar and folder graphs pass
  //    none of them and behave exactly as before) ───────────────────────────
  /** Tags to draw a halo and label around. Pressing one filters to it. */
  clusterTags?: string[];
  onClusterClick?: (tag: string) => void;
  /** Called for a background press that did NOT land on a cluster. */
  onBackgroundClick?: () => void;
  /** Re-frames the view whenever this string changes. */
  fitSignal?: string;
  /**
   * What to say instead of mounting the canvas on an empty set. Supplying it
   * also gates the mount on having nodes — see CLAUDE.md on the force-graph
   * layout race; an empty graph is the state that trips it.
   */
  emptyMessage?: string;
}

export function GraphView({
  graph, graphData, selectedId, linkMode, linkSource,
  width, height, onNodeClick, onEngineStop, onToggleLinkMode, hideToolbar,
  onCreateNode, onDeleteNode, onDeleteEdge,
  clusterTags, onClusterClick, onBackgroundClick, fitSignal, emptyMessage,
}: GraphViewProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("Note");
  const inputRef = useRef<HTMLInputElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  // Written by the frame painter, read by the click handler. A ref, not state:
  // the circles move on every tick, and lifting them would re-render the whole
  // pane sixty times a second to draw something the canvas already drew.
  const clusterRef = useRef<ClusterCircle[]>([]);

  // Run once on mount to configure forces. Do NOT re-run when graphData changes
  // (new reference each render) — that would call d3ReheatSimulation() on every
  // parent render and cause an animation-loop storm.
  useEffect(() => {
    const fg = fgRef.current as any;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-200);
    fg.d3Force("link")?.distance(70);
  }, []);

  // Re-frame when the caller says what is on screen has changed. Deferred: the
  // simulation has to place the new set before there is anything to fit to, and
  // zoomToFit against unplaced nodes frames the origin.
  useEffect(() => {
    if (fitSignal === undefined) return;
    const t = setTimeout(() => {
      const fg = fgRef.current as any;
      try { fg?.zoomToFit(400, 60); } catch { /* nothing placed yet */ }
    }, 420);
    return () => clearTimeout(t);
  }, [fitSignal]);

  /** Tag halos, drawn under nothing — the nodes are painted after this pass. */
  function renderFramePre(ctx: CanvasRenderingContext2D, globalScale: number) {
    if (!clusterTags?.length) {
      clusterRef.current = [];
      return;
    }
    const circles = tagClusters(graphData.nodes as any[], clusterTags);
    clusterRef.current = circles;
    for (const c of circles) {
      const color = graph.tag_colors[c.tag] || "#9ca3af";
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.max(5, 9 / globalScale)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(c.tag, c.x, c.y - c.r - 2 / globalScale);
      ctx.restore();
    }
  }

  function handleBackgroundClick(e: MouseEvent) {
    const fg = fgRef.current as any;
    if (onClusterClick && fg && clusterRef.current.length) {
      const target = e.target as HTMLElement | null;
      const rect = target?.getBoundingClientRect?.();
      const x = rect ? e.clientX - rect.left : (e as any).offsetX ?? 0;
      const y = rect ? e.clientY - rect.top : (e as any).offsetY ?? 0;
      try {
        const hit = hitTestClusters(clusterRef.current, fg.screen2GraphCoords(x, y));
        if (hit) { onClusterClick(hit); return; }
      } catch { /* fall through to the plain background press */ }
    }
    onBackgroundClick?.();
  }

  function paintNode(node: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    drawNode(node, ctx, globalScale, graph.tag_colors, node.id === selectedId, node.id === linkSource, linkMode);
  }

  // Custom link renderer — bypasses the library's hasOwnProperty('x') guard which
  // silently skips all links & arrows when source/target haven't been resolved yet.
  function paintLink(link: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    const start = typeof link.source === "object" ? link.source : null;
    const end   = typeof link.target === "object" ? link.target : null;
    if (!start || !end || start.x == null || end.x == null) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const lw = 1.5 / globalScale;

    // Line
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = lw;
    ctx.stroke();

    // Arrow head at 88% along the line
    const angle = Math.atan2(dy, dx);
    const arrowLen = 5 / globalScale;
    const spread = Math.PI * 0.38;
    const tx = start.x + dx * 0.88;
    const ty = start.y + dy * 0.88;
    ctx.beginPath();
    ctx.moveTo(tx + arrowLen * Math.cos(angle), ty + arrowLen * Math.sin(angle));
    ctx.lineTo(tx + arrowLen * Math.cos(angle + Math.PI - spread), ty + arrowLen * Math.sin(angle + Math.PI - spread));
    ctx.lineTo(tx + arrowLen * Math.cos(angle + Math.PI + spread), ty + arrowLen * Math.sin(angle + Math.PI + spread));
    ctx.closePath();
    ctx.fillStyle = "#9ca3af";
    ctx.fill();
  }

  function paintNodePointerArea(node: any, color: string, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, 8, 0, 2 * Math.PI);
    ctx.fill();
  }

  function openCreate() {
    setCreating(true);
    setNewName("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closeCreate() {
    setCreating(false);
    setNewName("");
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name || !onCreateNode) return;
    onCreateNode(name, newKind);
    closeCreate();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") closeCreate();
  }

  const selectedName = selectedId ? graph.nodes[selectedId]?.name : null;

  return (
    <div className="graph-container">
      {/* One short strip of icon buttons. It used to be three pill buttons
          spelling out "Link", "+ Node" and `Delete "<the whole node name>"`,
          which on a folder graph was wider than the graph under it and grew
          with the name. The create form still appears inline, and only after
          "+" — and Delete still routes to the app's single confirm gate. */}
      {!hideToolbar && (
        <div className="graph-toolbar">
          {!creating ? (
            <>
              <button
                className={`gtb-btn${linkMode ? " active" : ""}`}
                onClick={onToggleLinkMode}
                title={linkMode ? "Cancel linking" : "Link two nodes"}
                aria-label="Link two nodes"
                aria-pressed={linkMode}
              >
                ⊸
              </button>
              {onCreateNode && (
                <button className="gtb-btn" onClick={openCreate} title="New node" aria-label="New node">
                  +
                </button>
              )}
              {onDeleteNode && selectedId && (
                <button
                  className="gtb-btn gtb-danger"
                  onClick={() => onDeleteNode(selectedId)}
                  title={`Delete "${selectedName}"`}
                  aria-label={`Delete ${selectedName ?? "node"}`}
                >
                  ×
                </button>
              )}
              {/* The one thing a tooltip cannot carry: link mode is modal, so
                  which end you are picking has to be on screen. */}
              {linkMode && (
                <span className="gtb-hint">{linkSource ? "Select target…" : "Select source…"}</span>
              )}
            </>
          ) : (
            <>
              <input
                ref={inputRef}
                className="graph-create-input"
                placeholder="Node name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <select
                className="graph-create-select"
                value={newKind}
                onChange={e => setNewKind(e.target.value)}
              >
                <option>Note</option>
                <option>Folder</option>
                <option>CodeFile</option>
                <option>Table</option>
                <option>Database</option>
                <option>Workbook</option>
              </select>
              <button className="gtb-btn" onClick={handleCreate} disabled={!newName.trim()} title="Create">✓</button>
              <button className="gtb-btn" onClick={closeCreate} title="Cancel">✕</button>
            </>
          )}
        </div>
      )}
      {emptyMessage !== undefined && graphData.nodes.length === 0 ? (
        <div className="graph-empty-state">{emptyMessage}</div>
      ) : (
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#f8f9fa"
        onRenderFramePre={clusterTags?.length ? renderFramePre : undefined}
        onBackgroundClick={onClusterClick || onBackgroundClick ? handleBackgroundClick : undefined}
        nodeLabel=""
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => "replace" as const}
        nodeRelSize={5}
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => "replace" as const}
        warmupTicks={40}
        cooldownTime={3000}
        d3VelocityDecay={0.35}
        width={width}
        height={height}
        onEngineStop={onEngineStop}
        nodePointerAreaPaint={paintNodePointerArea}
        onNodeClick={(node: any) => onNodeClick(node.id)}
        onLinkClick={onDeleteEdge ? (link: any) => {
          const from = typeof link.source === "object" ? link.source.id : link.source;
          const to   = typeof link.target === "object" ? link.target.id : link.target;
          onDeleteEdge(from, to);
        } : undefined}
        linkHoverPrecision={8}
      />
      )}
    </div>
  );
}
