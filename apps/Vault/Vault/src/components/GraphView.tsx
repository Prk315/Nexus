import { useRef, useState, useEffect } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { VaultGraph } from "../types";
import { drawNode } from "../canvas/drawNode";

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
}

export function GraphView({
  graph, graphData, selectedId, linkMode, linkSource,
  width, height, onNodeClick, onEngineStop, onToggleLinkMode, hideToolbar,
  onCreateNode, onDeleteNode, onDeleteEdge,
}: GraphViewProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("Note");
  const inputRef = useRef<HTMLInputElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

  // Run once on mount to configure forces. Do NOT re-run when graphData changes
  // (new reference each render) — that would call d3ReheatSimulation() on every
  // parent render and cause an animation-loop storm.
  useEffect(() => {
    const fg = fgRef.current as any;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-200);
    fg.d3Force("link")?.distance(70);
  }, []);

  function paintNode(node: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    drawNode(node, ctx, globalScale, graph.tag_colors, node.id === selectedId, node.id === linkSource, linkMode);
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
      {!hideToolbar && (
        <div className="graph-toolbar">
          {!creating ? (
            <>
              <button className={`link-mode-btn ${linkMode ? "active" : ""}`} onClick={onToggleLinkMode}>
                {linkMode ? (linkSource ? "Select target…" : "Select source…") : "Link"}
              </button>
              {onCreateNode && (
                <button className="link-mode-btn" onClick={openCreate}>+ Node</button>
              )}
              {onDeleteNode && selectedId && (
                <button
                  className="link-mode-btn graph-delete-btn"
                  onClick={() => onDeleteNode(selectedId)}
                  title={`Delete "${selectedName}"`}
                >
                  Delete{selectedName ? ` "${selectedName}"` : ""}
                </button>
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
              <button className="link-mode-btn" onClick={handleCreate} disabled={!newName.trim()}>✓</button>
              <button className="link-mode-btn" onClick={closeCreate}>✕</button>
            </>
          )}
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#f8f9fa"
        nodeLabel=""
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => "replace" as const}
        nodeRelSize={5}
        linkColor={() => "#d1d5db"}
        linkWidth={0.8}
        linkCurvature={0.08}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.88}
        linkDirectionalArrowColor={() => "#c9cdd4"}
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
    </div>
  );
}
