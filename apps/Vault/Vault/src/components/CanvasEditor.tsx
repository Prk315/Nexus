import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatrixBlockContent, MatrixBlockData } from "./MatrixBlock";
import { GraphBlockContent, GraphBlockData } from "./GraphBlock";
import { GridBlockContent, GridBlockData } from "./GridBlock";
import { invoke } from "@tauri-apps/api/core";
import initSqlJs from 'sql.js';
import type { SqlJsStatic, Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import "katex/dist/katex.min.css";
import SmilesDrawer from 'smiles-drawer';
import 'katex/contrib/mhchem';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BaseBlock { id: string; x: number; y: number; width: number; height: number; }
interface TextBlock      extends BaseBlock { type: "text";      content: string; preview?: boolean; }
interface StickyBlock    extends BaseBlock { type: "sticky";    content: string; color: string; }
interface TitleBlock     extends BaseBlock { type: "title";     text: string;    level: 1 | 2 | 3; fontSize?: number; }
interface DividerBlock   extends BaseBlock { type: "divider";   x2: number; y2: number; divStyle: "solid" | "dashed" | "dotted"; }
interface TableBlock     extends BaseBlock { type: "table"; headers: string[]; rows: string[][]; colWidths?: number[]; rowHeights?: number[]; }
interface MathBlock      extends BaseBlock { type: "math";      formula: string; preview?: boolean; }
interface ChecklistItem  { id: string; text: string; checked: boolean; }
interface ChecklistBlock extends BaseBlock { type: "checklist"; title: string; items: ChecklistItem[]; }
interface KanbanCard     { id: string; text: string; }
interface KanbanColumn   { id: string; title: string; cards: KanbanCard[]; }
interface KanbanBlock    extends BaseBlock { type: "kanban"; columns: KanbanColumn[]; }
type ShapeKind = "rect" | "rounded" | "ellipse" | "diamond";
interface ShapeBlock     extends BaseBlock { type: "shape"; shape: ShapeKind; label: string; color?: string; }
interface FrameBlock     extends BaseBlock { type: "frame"; label: string; color?: string; borderStyle?: "solid" | "dashed" | "dotted"; borderWidth?: number; radius?: number; fill?: string; }
interface OutputChunk    { type: "text" | "image" | "error" | "html" | "table"; content: string; }
interface CodeCellBlock  extends BaseBlock { type: "code_cell"; code: string; outputs: OutputChunk[]; running: boolean; language?: "python" | "sql"; }
interface HtmlBlock      extends BaseBlock { type: "html"; code: string; preview: boolean; }
interface ImageBlock     extends BaseBlock { type: "image"; src: string; }
interface MoleculeBlock  extends BaseBlock { type: "molecule"; smiles: string; label: string; }
interface ChemEqBlock    extends BaseBlock { type: "chem_eq"; formula: string; label: string; preview: boolean; }
interface ElementBlock   extends BaseBlock { type: "element"; symbol: string; }
interface MolAtom        { id: string; symbol: string; x: number; y: number; }
interface MolBond        { id: string; from: string; to: string; order: 1 | 2 | 3; }
interface MolDrawBlock   extends BaseBlock { type: "mol_draw"; atoms: MolAtom[]; bonds: MolBond[]; label: string; }
// ── Freehand drawing shapes ───────────────────────────────────────────────────
interface DrawArrowBlock  extends BaseBlock { type: "draw_arrow";   x2: number; y2: number; color: string; strokeWidth: number; dashed: boolean; headEnd: boolean; headStart: boolean; }
interface DrawEllipseBlock extends BaseBlock { type: "draw_ellipse"; color: string; fill: string; strokeWidth: number; dashed: boolean; }
interface DrawPolygonBlock extends BaseBlock { type: "draw_polygon"; points: { x: number; y: number }[]; closed: boolean; color: string; fill: string; strokeWidth: number; dashed: boolean; }
interface InkStrokeBlock  extends BaseBlock { type: "ink_stroke";  points: { x: number; y: number }[]; color: string; strokeWidth: number; }

type CanvasBlock = TextBlock | StickyBlock | TitleBlock | DividerBlock | TableBlock | MathBlock
                | ChecklistBlock | KanbanBlock | ShapeBlock | FrameBlock | CodeCellBlock | HtmlBlock | ImageBlock
                | MoleculeBlock | ChemEqBlock | ElementBlock | MolDrawBlock | MatrixBlockData | GraphBlockData | GridBlockData
                | DrawArrowBlock | DrawEllipseBlock | DrawPolygonBlock | InkStrokeBlock;
type Patch = Record<string, unknown>;
type Port = "top" | "right" | "bottom" | "left";
interface Arrow { id: string; fromId: string; fromPort: Port; toId: string; toPort: Port; waypoints?: { id: string; x: number; y: number }[]; }
interface PendingArrow { fromId: string; fromPort: Port; }
interface CanvasData { blocks: CanvasBlock[]; arrows: Arrow[]; }

// ── Constants ──────────────────────────────────────────────────────────────────

const STICKY_COLORS = [
  { bg: "#2b2500", accent: "#d4b840" },
  { bg: "#0b1e38", accent: "#5aa8d8" },
  { bg: "#0a2018", accent: "#46b860" },
  { bg: "#2a0c18", accent: "#c84870" },
  { bg: "#170b28", accent: "#8850c8" },
];

const DRAW_COLORS = ["#64748b","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#ec4899","#ffffff","#0f172a"];
const DRAW_FILLS  = ["none","rgba(239,68,68,0.15)","rgba(249,115,22,0.15)","rgba(234,179,8,0.15)","rgba(34,197,94,0.15)","rgba(59,130,246,0.15)","rgba(168,85,247,0.15)","rgba(236,72,153,0.15)","rgba(255,255,255,0.15)","rgba(15,23,42,0.4)"];

const PORTS: Port[] = ["top", "right", "bottom", "left"];
const SHAPE_ICONS: Record<ShapeKind, string> = { rect: "▭", rounded: "▢", ellipse: "○", diamond: "◇" }
const SHAPE_COLORS = ["#ffffff","#fef9c3","#dbeafe","#dcfce7","#fce7f3","#f3e8ff","#ffedd5","#e2e8f0","#1e293b"];
const FRAME_COLORS = ["#94a3b8","#60a5fa","#34d399","#facc15","#f472b6","#a78bfa","#fb923c","#f87171"];
const FRAME_FILLS  = [
  "transparent",
  "rgba(148,163,184,0.09)", "rgba(96,165,250,0.09)",  "rgba(52,211,153,0.09)",
  "rgba(250,204,21,0.09)",  "rgba(244,114,182,0.09)", "rgba(167,139,250,0.09)",
  "rgba(251,146,60,0.09)",  "rgba(248,113,113,0.09)",
];;

function stickyPreset(bg: string) {
  return STICKY_COLORS.find(p => p.bg === bg) ?? STICKY_COLORS[0];
}

// ── Data helpers ───────────────────────────────────────────────────────────────

function migrateBlock(b: any): CanvasBlock {
  // Migrate code_cell blocks saved with old output/outputType fields
  if (b.type === "code_cell" && !Array.isArray(b.outputs)) {
    const outputs: OutputChunk[] = [];
    if (b.output != null) outputs.push({ type: b.outputType ?? "text", content: b.output });
    return { ...b, outputs, running: false, language: b.language ?? "python" } as CodeCellBlock;
  }
  return b as CanvasBlock;
}

function parseData(raw: string): CanvasData {
  if (!raw) return { blocks: [], arrows: [] };
  try {
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.blocks))
      return { blocks: d.blocks.map(migrateBlock), arrows: Array.isArray(d.arrows) ? d.arrows : [] };
  } catch { /* fall through */ }
  return { blocks: [], arrows: [] };
}

const uid = () => crypto.randomUUID();

function mkText(x: number, y: number): TextBlock {
  return { id: uid(), type: "text", x, y, width: 300, height: 180, content: "", preview: false };
}
function mkSticky(x: number, y: number): StickyBlock {
  return { id: uid(), type: "sticky", x, y, width: 240, height: 220, content: "", color: STICKY_COLORS[0].bg };
}
function mkTitle(x: number, y: number): TitleBlock {
  return { id: uid(), type: "title", x, y, width: 420, height: 76, text: "", level: 1 };
}
function mkDivider(x: number, y: number): DividerBlock {
  // x = cursor_canvas_x - 150, y = cursor_canvas_y - 80 (from addBlock)
  return { id: uid(), type: "divider", x, y: y + 80, x2: x + 300, y2: y + 80, width: 0, height: 0, divStyle: "solid" };
}
function mkTable(x: number, y: number): TableBlock {
  return {
    id: uid(), type: "table", x, y, width: 520, height: 240,
    headers: ["Column A", "Column B", "Column C"],
    rows: [["", "", ""], ["", "", ""]],
  };
}
function mkMath(x: number, y: number): MathBlock {
  return { id: uid(), type: "math", x, y, width: 360, height: 160, formula: "", preview: false };
}
function mkChecklist(x: number, y: number): ChecklistBlock {
  return { id: uid(), type: "checklist", x, y, width: 280, height: 300, title: "Checklist", items: [] };
}
function mkKanban(x: number, y: number): KanbanBlock {
  return {
    id: uid(), type: "kanban", x, y, width: 660, height: 380,
    columns: [
      { id: uid(), title: "To Do",       cards: [] },
      { id: uid(), title: "In Progress", cards: [] },
      { id: uid(), title: "Done",        cards: [] },
    ],
  };
}
function mkShape(x: number, y: number): ShapeBlock {
  return { id: uid(), type: "shape", shape: "rounded", x, y, width: 180, height: 80, label: "" };
}
function mkFrame(x: number, y: number): FrameBlock {
  return { id: uid(), type: "frame", x, y, width: 480, height: 320, label: "Group", color: "#94a3b8", borderStyle: "dashed", borderWidth: 2, radius: 10, fill: "transparent" };
}
function mkCodeCell(x: number, y: number): CodeCellBlock {
  return { id: uid(), type: "code_cell", x, y, width: 440, height: 260, code: "", outputs: [], running: false, language: "python" };
}
function mkHtml(x: number, y: number): HtmlBlock {
  return { id: uid(), type: "html", x, y, width: 560, height: 400, code: "", preview: false };
}
function mkImage(x: number, y: number, src: string, w = 400, h = 300): ImageBlock {
  return { id: uid(), type: "image", x, y, width: w, height: h, src };
}
function mkMolecule(x: number, y: number): MoleculeBlock {
  return { id: uid(), type: "molecule", x, y, width: 320, height: 320, smiles: "", label: "" };
}
function mkChemEq(x: number, y: number): ChemEqBlock {
  return { id: uid(), type: "chem_eq", x, y, width: 420, height: 140, formula: "", label: "", preview: false };
}
function mkElement(x: number, y: number): ElementBlock {
  return { id: uid(), type: "element", x, y, width: 160, height: 200, symbol: "C" };
}
function mkMolDraw(x: number, y: number): MolDrawBlock {
  return { id: uid(), type: "mol_draw", x, y, width: 420, height: 360, atoms: [], bonds: [], label: "" };
}
function mkDrawArrow(x: number, y: number, x2: number, y2: number): DrawArrowBlock {
  return { id: uid(), type: "draw_arrow", x, y, x2, y2, width: 0, height: 0, color: "#64748b", strokeWidth: 2, dashed: false, headEnd: true, headStart: false };
}
function mkDrawEllipse(x: number, y: number, w: number, h: number): DrawEllipseBlock {
  return { id: uid(), type: "draw_ellipse", x, y, width: Math.max(w, 10), height: Math.max(h, 10), color: "#64748b", fill: "none", strokeWidth: 2, dashed: false };
}
function mkDrawPolygon(points: { x: number; y: number }[], closed: boolean): DrawPolygonBlock {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const bx = Math.min(...xs), by = Math.min(...ys);
  return { id: uid(), type: "draw_polygon", x: bx, y: by, width: Math.max(...xs) - bx || 10, height: Math.max(...ys) - by || 10, points, closed, color: "#64748b", fill: "none", strokeWidth: 2, dashed: false };
}
function pointsToSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
function mkInkStroke(points: { x: number; y: number }[], color: string, strokeWidth: number): InkStrokeBlock {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const bx = Math.min(...xs), by = Math.min(...ys);
  return { id: uid(), type: "ink_stroke", x: bx, y: by,
    width: Math.max(...xs) - bx || 1, height: Math.max(...ys) - by || 1,
    points, color, strokeWidth };
}

function mkSimpleGrid(x: number, y: number): GridBlockData {
  return {
    id: uid(), type: "simple_grid", x, y, width: 260, height: 160,
    rows: 3, cols: 3,
    cells: Array.from({ length: 3 }, () => Array(3).fill("")),
    brackets: true,
  };
}
function mkGraphTheory(x: number, y: number): GraphBlockData {
  return {
    id: uid(), type: "graph_theory", x, y, width: 480, height: 360,
    nodes: [], edges: [], directed: false, weighted: false,
  };
}
function mkMatrix(x: number, y: number): MatrixBlockData {
  return {
    id: uid(), type: "matrix", x, y, width: 360, height: 320,
    rows: 3, cols: 3, augmented: false,
    cells: [["1","2","3"],["4","5","6"],["7","8","9"]],
    steps: [],
  };
}

// Returns a stable session ID for the connected component containing cellId.
// Cells not connected by any arrows each get their own isolated session.
function getComponentSessionId(cellId: string, canvasId: string | undefined, blocks: CanvasBlock[], arrows: Arrow[]): string {
  const cellIds = new Set(blocks.filter(b => b.type === "code_cell").map(b => b.id));
  if (!cellIds.has(cellId)) return cellId;

  const adj: Record<string, Set<string>> = {};
  cellIds.forEach(id => { adj[id] = new Set(); });
  arrows
    .filter(a => cellIds.has(a.fromId) && cellIds.has(a.toId))
    .forEach(a => { adj[a.fromId].add(a.toId); adj[a.toId].add(a.fromId); });

  const component = new Set<string>();
  const queue = [cellId];
  while (queue.length) {
    const id = queue.shift()!;
    if (component.has(id)) continue;
    component.add(id);
    adj[id].forEach(n => { if (!component.has(n)) queue.push(n); });
  }

  const prefix = canvasId ? canvasId + ":" : "";
  return prefix + [...component].sort().join(",");
}

function getExecutionOrder(blocks: CanvasBlock[], arrows: Arrow[]): string[] {
  const cellIds = new Set(blocks.filter(b => b.type === "code_cell").map(b => b.id));
  const relevant = arrows.filter(a => cellIds.has(a.fromId) && cellIds.has(a.toId));
  const inDeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  cellIds.forEach(id => { inDeg[id] = 0; adj[id] = []; });
  relevant.forEach(a => { adj[a.fromId].push(a.toId); inDeg[a.toId]++; });
  const queue = [...cellIds].filter(id => inDeg[id] === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    adj[id].forEach(nxt => { if (--inDeg[nxt] === 0) queue.push(nxt); });
  }
  return order;
}

// ── Arrow geometry ─────────────────────────────────────────────────────────────

function getPortPos(block: CanvasBlock, port: Port): { x: number; y: number } {
  const { x, y, width, height } = block;
  if (port === "top")    return { x: x + width / 2, y };
  if (port === "right")  return { x: x + width,     y: y + height / 2 };
  if (port === "bottom") return { x: x + width / 2, y: y + height };
  return { x, y: y + height / 2 };
}

function portOffset(port: Port, dist: number): { dx: number; dy: number } {
  if (port === "top")    return { dx: 0,     dy: -dist };
  if (port === "bottom") return { dx: 0,     dy: dist  };
  if (port === "left")   return { dx: -dist, dy: 0     };
  return                        { dx: dist,  dy: 0     };
}

function makeBezier(
  p1: { x: number; y: number }, port1: Port,
  p2: { x: number; y: number }, port2: Port,
): string {
  const dist = Math.max(50, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4);
  const c1 = portOffset(port1, dist);
  const c2 = portOffset(port2, dist);
  return `M ${p1.x} ${p1.y} C ${p1.x + c1.dx} ${p1.y + c1.dy} ${p2.x + c2.dx} ${p2.y + c2.dy} ${p2.x} ${p2.y}`;
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function waypointInsertIndex(pts: { x: number; y: number }[], newPt: { x: number; y: number }): number {
  let bestDist = Infinity, bestIdx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(newPt, pts[i], pts[i + 1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

function makePathWithWaypoints(
  p1: { x: number; y: number }, port1: Port,
  p2: { x: number; y: number }, port2: Port,
  waypoints: { id: string; x: number; y: number }[],
): string {
  if (waypoints.length === 0) return makeBezier(p1, port1, p2, port2);
  const pts = [p1, ...waypoints.map(w => ({ x: w.x, y: w.y })), p2];
  let d = `M ${p1.x} ${p1.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segDist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
    let c1x: number, c1y: number;
    if (i === 0) {
      const off = portOffset(port1, segDist);
      c1x = a.x + off.dx; c1y = a.y + off.dy;
    } else {
      const prev = pts[i - 1];
      const dx = b.x - prev.x, dy = b.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      c1x = a.x + (dx / len) * segDist; c1y = a.y + (dy / len) * segDist;
    }
    let c2x: number, c2y: number;
    if (i === pts.length - 2) {
      const off = portOffset(port2, segDist);
      c2x = b.x + off.dx; c2y = b.y + off.dy;
    } else {
      const next = pts[i + 2];
      const dx = next.x - a.x, dy = next.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      c2x = b.x - (dx / len) * segDist; c2y = b.y - (dy / len) * segDist;
    }
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
  }
  return d;
}

function portDotStyle(port: Port): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute", width: 12, height: 12, borderRadius: "50%",
    transform: "translate(-50%, -50%)", zIndex: 10, cursor: "crosshair",
    background: "var(--accent-fg, #5aa8d8)", border: "2px solid var(--bg-base)",
    boxSizing: "border-box", transition: "transform 0.1s ease",
  };
  if (port === "top")    return { ...base, left: "50%",  top: 0      };
  if (port === "right")  return { ...base, left: "100%", top: "50%"  };
  if (port === "bottom") return { ...base, left: "50%",  top: "100%" };
  return                        { ...base, left: 0,       top: "50%"  };
}

// ── ShapeSvg ──────────────────────────────────────────────────────────────────

function ShapeSvg({ shape, width, height, selected, color }: { shape: ShapeKind; width: number; height: number; selected: boolean; color?: string }) {
  const s = 1.5;
  const stroke = selected ? "var(--border-strong)" : "var(--border-base)";
  const sw     = selected ? 2 : 1.5;
  const fill   = color ?? "var(--bg-base)";
  const props  = { fill, stroke, strokeWidth: sw };
  if (shape === "rect")
    return <rect x={s} y={s} width={width - s * 2} height={height - s * 2} rx={4} {...props} />;
  if (shape === "rounded") {
    const r = Math.min(height / 2 - s, 24);
    return <rect x={s} y={s} width={width - s * 2} height={height - s * 2} rx={r} {...props} />;
  }
  if (shape === "ellipse")
    return <ellipse cx={width / 2} cy={height / 2} rx={width / 2 - s} ry={height / 2 - s} {...props} />;
  const mx = width / 2, my = height / 2;
  return <polygon points={`${mx},${s} ${width - s},${my} ${mx},${height - s} ${s},${my}`} {...props} />;
}

// ── ChecklistContent ──────────────────────────────────────────────────────────

function ChecklistContent({ block, onUpdate }: { block: ChecklistBlock; onUpdate: (id: string, p: Patch) => void }) {
  const [newText, setNewText] = useState("");
  const done = block.items.filter(i => i.checked).length;

  function addItem() {
    const text = newText.trim();
    if (!text) return;
    onUpdate(block.id, { items: [...block.items, { id: uid(), text, checked: false }] });
    setNewText("");
  }

  return (
    <div className="canvas-checklist" onPointerDown={e => e.stopPropagation()}>
      {block.items.length > 0 && (
        <div className="canvas-checklist-progress-bar">
          <div className="canvas-checklist-progress-fill" style={{ width: `${(done / block.items.length) * 100}%` }} />
        </div>
      )}
      <div className="canvas-checklist-items">
        {block.items.map(item => (
          <label key={item.id} className={`canvas-checklist-item${item.checked ? " done" : ""}`}>
            <input type="checkbox" checked={item.checked}
              onChange={() => onUpdate(block.id, { items: block.items.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i) })} />
            <span className="canvas-checklist-label">{item.text}</span>
            <button className="canvas-block-close" onClick={() => onUpdate(block.id, { items: block.items.filter(i => i.id !== item.id) })}>×</button>
          </label>
        ))}
      </div>
      <div className="canvas-checklist-add">
        <input className="canvas-checklist-input" placeholder="Add item…" value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") addItem(); }} />
        <button className="canvas-add-btn" onClick={addItem}>+</button>
      </div>
    </div>
  );
}

// ── KanbanContent ─────────────────────────────────────────────────────────────

function KanbanContent({ block, onUpdate, onSelect }: { block: KanbanBlock; onUpdate: (id: string, p: Patch) => void; onSelect?: () => void }) {
  const [addingCol, setAddingCol] = useState<string | null>(null);
  const [newCard,   setNewCard]   = useState("");
  function setCols(columns: KanbanColumn[]) { onUpdate(block.id, { columns }); }
  function addCard(colId: string) {
    const text = newCard.trim();
    if (!text) return;
    setCols(block.columns.map(c => c.id === colId ? { ...c, cards: [...c.cards, { id: uid(), text }] } : c));
    setNewCard(""); setAddingCol(null);
  }
  function deleteCard(colId: string, cardId: string) {
    setCols(block.columns.map(c => c.id === colId ? { ...c, cards: c.cards.filter(k => k.id !== cardId) } : c));
  }
  function moveCard(cardId: string, fromIdx: number, dir: -1 | 1) {
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= block.columns.length) return;
    const card = block.columns[fromIdx].cards.find(c => c.id === cardId);
    if (!card) return;
    setCols(block.columns.map((col, i) => {
      if (i === fromIdx) return { ...col, cards: col.cards.filter(c => c.id !== cardId) };
      if (i === toIdx)   return { ...col, cards: [...col.cards, card] };
      return col;
    }));
  }
  return (
    <div className="canvas-kanban" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
      {block.columns.map((col, colIdx) => (
        <div key={col.id} className="canvas-kanban-col">
          <div className="canvas-kanban-col-header">
            <input className="canvas-kanban-col-title" value={col.title}
              onChange={e => setCols(block.columns.map(c => c.id === col.id ? { ...c, title: e.target.value } : c))} />
            <span className="canvas-kanban-count">{col.cards.length}</span>
          </div>
          <div className="canvas-kanban-cards">
            {col.cards.map(card => (
              <div key={card.id} className="canvas-kanban-card">
                <span className="canvas-kanban-card-text">{card.text}</span>
                <div className="canvas-kanban-card-btns">
                  {colIdx > 0 && <button className="canvas-kanban-move" onClick={() => moveCard(card.id, colIdx, -1)}>←</button>}
                  {colIdx < block.columns.length - 1 && <button className="canvas-kanban-move" onClick={() => moveCard(card.id, colIdx, 1)}>→</button>}
                  <button className="canvas-block-close" onClick={() => deleteCard(col.id, card.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
          {addingCol === col.id ? (
            <div className="canvas-kanban-add-form">
              <textarea autoFocus className="canvas-kanban-add-input" value={newCard} rows={2} placeholder="Card text…"
                onChange={e => setNewCard(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCard(col.id); }
                  if (e.key === "Escape") { setAddingCol(null); setNewCard(""); }
                }} />
              <div className="canvas-kanban-add-btns">
                <button className="canvas-add-btn" onClick={() => addCard(col.id)}>Add</button>
                <button className="canvas-add-btn" onClick={() => { setAddingCol(null); setNewCard(""); }}>✕</button>
              </div>
            </div>
          ) : (
            <button className="canvas-kanban-add-card-btn" onClick={() => { setAddingCol(col.id); setNewCard(""); }}>
              + Add card
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── TableContent ──────────────────────────────────────────────────────────────

const MIN_COL_W = 44;
const MIN_ROW_H = 28;
const DEFAULT_COL_W = 120;
const DEFAULT_ROW_H = 34;

function TableContent({ block, onUpdate, onSelect, zoom = 1 }: {
  block: TableBlock; onUpdate: (id: string, p: Patch) => void;
  onSelect?: () => void; zoom?: number;
}) {
  const numCols = block.headers.length;
  const numRows = block.rows.length;

  // Derive effective widths/heights, falling back to defaults when absent
  const colWidths: number[] = (block.colWidths?.length === numCols)
    ? block.colWidths
    : Array(numCols).fill(DEFAULT_COL_W);
  const rowHeights: number[] = (block.rowHeights?.length === numRows)
    ? block.rowHeights
    : Array(numRows).fill(DEFAULT_ROW_H);

  function setHeader(ci: number, value: string) {
    onUpdate(block.id, { headers: block.headers.map((h, i) => i === ci ? value : h) });
  }
  function setCell(ri: number, ci: number, value: string) {
    onUpdate(block.id, { rows: block.rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? value : c) : r) });
  }
  function addRow() {
    onUpdate(block.id, {
      rows: [...block.rows, new Array(numCols).fill("")],
      rowHeights: [...rowHeights, DEFAULT_ROW_H],
    });
  }
  function removeRow(ri: number) {
    if (numRows <= 1) return;
    onUpdate(block.id, {
      rows: block.rows.filter((_, i) => i !== ri),
      rowHeights: rowHeights.filter((_, i) => i !== ri),
    });
  }
  function addCol() {
    onUpdate(block.id, {
      headers: [...block.headers, `Col ${numCols + 1}`],
      rows: block.rows.map(r => [...r, ""]),
      colWidths: [...colWidths, DEFAULT_COL_W],
    });
  }
  function removeCol(ci: number) {
    if (numCols <= 1) return;
    onUpdate(block.id, {
      headers: block.headers.filter((_, i) => i !== ci),
      rows: block.rows.map(r => r.filter((_, i) => i !== ci)),
      colWidths: colWidths.filter((_, i) => i !== ci),
    });
  }

  function cellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, _ri: number, ci: number) {
    if (e.key === "Tab") {
      e.preventDefault();
      const table = (e.target as HTMLElement).closest(".canvas-table");
      const inputs = table ? Array.from(table.querySelectorAll<HTMLInputElement>("input")) : [];
      const idx = inputs.indexOf(e.target as HTMLInputElement);
      const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1];
      if (next) { next.focus(); return; }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const table = (e.target as HTMLElement).closest(".canvas-table");
      const allTds = table ? Array.from(table.querySelectorAll<HTMLInputElement>("tbody input")) : [];
      const col = allTds.filter((_, i) => i % numCols === ci);
      const rowIdx = col.indexOf(e.target as HTMLInputElement);
      if (rowIdx === col.length - 1) addRow();
      else col[rowIdx + 1]?.focus();
    }
  }

  // ── Column resize ──────────────────────────────────────────────────────────
  function onColResizePointerDown(e: React.PointerEvent, ci: number) {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[ci];
    function onMove(ev: PointerEvent) {
      const delta = (ev.clientX - startX) / zoom;
      const newW = Math.max(MIN_COL_W, startW + delta);
      onUpdate(block.id, { colWidths: colWidths.map((w, i) => i === ci ? newW : w) });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── Row resize ─────────────────────────────────────────────────────────────
  function onRowResizePointerDown(e: React.PointerEvent, ri: number) {
    e.stopPropagation(); e.preventDefault();
    const startY = e.clientY;
    const startH = rowHeights[ri];
    function onMove(ev: PointerEvent) {
      const delta = (ev.clientY - startY) / zoom;
      const newH = Math.max(MIN_ROW_H, startH + delta);
      onUpdate(block.id, { rowHeights: rowHeights.map((h, i) => i === ri ? newH : h) });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="canvas-table-wrap" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
      <table className="canvas-table" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {colWidths.map((w, ci) => <col key={ci} style={{ width: w }} />)}
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            {block.headers.map((h, ci) => (
              <th key={ci} className="canvas-table-th">
                <input
                  className="canvas-table-cell canvas-table-header-cell"
                  value={h}
                  onChange={e => setHeader(ci, e.target.value)}
                />
                {block.headers.length > 1 && (
                  <button className="canvas-table-del-col" onClick={() => removeCol(ci)} title="Remove column">×</button>
                )}
                {/* Column resize handle */}
                <div className="canvas-table-col-resize"
                  onPointerDown={e => onColResizePointerDown(e, ci)} />
              </th>
            ))}
            <th className="canvas-table-add-col-th">
              <button className="canvas-table-add-col-btn" onClick={addCol} title="Add column">+</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className="canvas-table-row" style={{ height: rowHeights[ri] }}>
              {row.map((cell, ci) => (
                <td key={ci} className="canvas-table-td">
                  <input
                    className="canvas-table-cell"
                    value={cell}
                    placeholder="…"
                    onChange={e => setCell(ri, ci, e.target.value)}
                    onKeyDown={e => cellKeyDown(e, ri, ci)}
                  />
                </td>
              ))}
              <td className="canvas-table-row-actions">
                {block.rows.length > 1 && (
                  <button className="canvas-table-del-row" onClick={() => removeRow(ri)} title="Remove row">×</button>
                )}
                {/* Row resize handle */}
                <div className="canvas-table-row-resize"
                  onPointerDown={e => onRowResizePointerDown(e, ri)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="canvas-table-add-row-btn" onClick={addRow}>+ Row</button>
    </div>
  );
}

// ── Shared canvas block clipboard (module-level so all panes share it) ───────
let sharedCanvasClipboard: CanvasBlock[] | null = null;

// Clear internal clipboard when user leaves the app so a screenshot won't be
// shadowed by stale canvas blocks on the next Cmd+V.
window.addEventListener("blur", () => { sharedCanvasClipboard = null; });

// ── System clipboard paste (WKWebView sync fix) ────────────────────────────────
// WKWebView on macOS doesn't sync the OS clipboard into the WebView clipboard
// until the WebView itself triggers the paste, so e.clipboardData / navigator.clipboard
// may return stale content. We read directly from NSPasteboard via the Tauri plugin.
async function handleNativePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
  // Capture refs BEFORE the async gap — React nulls e.currentTarget after the handler returns
  const ta           = e.currentTarget;
  const start        = ta.selectionStart ?? 0;
  const end          = ta.selectionEnd   ?? 0;
  const browserText  = e.clipboardData?.getData("text") ?? "";

  e.preventDefault();

  let text: string;
  try {
    text = await clipboardReadText();
    if (!text) text = browserText; // plugin returned empty, fall back
  } catch {
    text = browserText;            // plugin unavailable, fall back
  }

  if (!text) return;

  const newVal = ta.value.slice(0, start) + text + ta.value.slice(end);
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, "value"
  )?.set;
  nativeSetter?.call(ta, newVal);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + text.length; });
}

// ── MathContent ───────────────────────────────────────────────────────────────

function MathContent({ block, onUpdate }: { block: MathBlock; onUpdate: (id: string, p: Patch) => void }) {
  const rendered = useMemo(() => {
    if (!block.preview) return null;
    const src = block.formula.trim() || "\\text{empty}";
    try {
      return katex.renderToString(src, { throwOnError: false, displayMode: true });
    } catch {
      return null;
    }
  }, [block.formula, block.preview]);

  if (block.preview) {
    return (
      <div
        className="canvas-math-preview"
        dangerouslySetInnerHTML={{ __html: rendered ?? "" }}
        onPointerDown={e => e.stopPropagation()}
      />
    );
  }
  return (
    <textarea
      className="canvas-block-text canvas-math-input"
      value={block.formula}
      placeholder={"LaTeX formula…\ne.g.  \\frac{a}{b}  or  E = mc^2"}
      spellCheck={false}
      onChange={e => onUpdate(block.id, { formula: e.target.value })}
      onPaste={handleNativePaste}
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
  );
}

// ── Snap-to-align ─────────────────────────────────────────────────────────────

interface SnapGuide { type: "v" | "h"; pos: number; }

const SNAP_PX = 6; // screen-pixel threshold

function computeSnap(
  blocks: CanvasBlock[],
  draggedIds: Set<string>,
  cx: number, cy: number,   // candidate top-left of primary block
  w: number,  h: number,    // primary block dimensions
  zoom: number,
): { sx: number; sy: number; guides: SnapGuide[] } {
  const threshold = SNAP_PX / zoom;
  const others = blocks.filter(b => !draggedIds.has(b.id) && b.type !== "divider");

  // Edge triplets for the candidate block
  const xCands = [cx, cx + w / 2, cx + w];
  const yCands = [cy, cy + h / 2, cy + h];

  let bestX: { diff: number; offset: number; pos: number } | null = null;
  let bestY: { diff: number; offset: number; pos: number } | null = null;

  for (const b of others) {
    const xTargets = [b.x, b.x + b.width / 2, b.x + b.width];
    const yTargets = [b.y, b.y + b.height / 2, b.y + b.height];

    for (const cVal of xCands) {
      for (const oVal of xTargets) {
        const diff = Math.abs(cVal - oVal);
        if (diff < threshold && (!bestX || diff < bestX.diff))
          bestX = { diff, offset: oVal - cVal, pos: oVal };
      }
    }
    for (const cVal of yCands) {
      for (const oVal of yTargets) {
        const diff = Math.abs(cVal - oVal);
        if (diff < threshold && (!bestY || diff < bestY.diff))
          bestY = { diff, offset: oVal - cVal, pos: oVal };
      }
    }
  }

  return {
    sx: bestX ? cx + bestX.offset : cx,
    sy: bestY ? cy + bestY.offset : cy,
    guides: [
      ...(bestX ? [{ type: "v" as const, pos: bestX.pos }] : []),
      ...(bestY ? [{ type: "h" as const, pos: bestY.pos }] : []),
    ],
  };
}

// ── Canvas navigation helpers ──────────────────────────────────────────────────

function getContentBounds(blocks: CanvasBlock[]): { x: number; y: number; w: number; h: number } {
  if (blocks.length === 0) return { x: -400, y: -300, w: 800, h: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of blocks) {
    if (b.type === "divider") {
      minX = Math.min(minX, b.x, b.x2); minY = Math.min(minY, b.y, b.y2);
      maxX = Math.max(maxX, b.x, b.x2); maxY = Math.max(maxY, b.y, b.y2);
    } else {
      minX = Math.min(minX, b.x);             minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);   maxY = Math.max(maxY, b.y + b.height);
    }
  }
  const pad = 60;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function miniBlockFill(b: CanvasBlock): string {
  if (b.type === "sticky")   return b.color ?? "#fef9c3";
  if (b.type === "title")    return "#e0e7ff";
  if (b.type === "frame")    return (b.color ?? "#94a3b8") + "33";
  if (b.type === "shape")    return b.color ?? "#dbeafe";
  if (b.type === "divider")  return "#94a3b8";
  if (b.type === "math")     return "#f3e8ff";
  if (b.type === "matrix")      return "#dbeafe";
  if (b.type === "simple_grid")  return "#f0fdf4";
  if (b.type === "graph_theory") return "#d1fae5";
  if (b.type === "draw_ellipse") return "#ede9fe";
  if (b.type === "draw_polygon") return "#fce7f3";
  if (b.type === "ink_stroke")  return b.color + "33";
  if (b.type === "checklist") return "#dcfce7";
  if (b.type === "kanban")    return "#fce7f3";
  if (b.type === "code_cell") return "#1e1e2e";
  if (b.type === "html")      return "#fff7ed";
  if (b.type === "molecule")  return "#f0fdf4";
  if (b.type === "chem_eq")   return "#fdf4ff";
  if (b.type === "element")   return "#fff7ed";
  if (b.type === "mol_draw")  return "#f0fdf4";
  return "#e2e8f0";
}

// ── Chemistry components ─────────────────────────────────────────────────────

const ELEMENT_DATA: { z: number; s: string; n: string; m: string; g: number; p: number }[] = [
  {z:1,s:"H",n:"Hydrogen",m:"1.008",g:1,p:1},{z:2,s:"He",n:"Helium",m:"4.003",g:18,p:1},
  {z:3,s:"Li",n:"Lithium",m:"6.941",g:1,p:2},{z:4,s:"Be",n:"Beryllium",m:"9.012",g:2,p:2},
  {z:5,s:"B",n:"Boron",m:"10.811",g:13,p:2},{z:6,s:"C",n:"Carbon",m:"12.011",g:14,p:2},
  {z:7,s:"N",n:"Nitrogen",m:"14.007",g:15,p:2},{z:8,s:"O",n:"Oxygen",m:"15.999",g:16,p:2},
  {z:9,s:"F",n:"Fluorine",m:"18.998",g:17,p:2},{z:10,s:"Ne",n:"Neon",m:"20.180",g:18,p:2},
  {z:11,s:"Na",n:"Sodium",m:"22.990",g:1,p:3},{z:12,s:"Mg",n:"Magnesium",m:"24.305",g:2,p:3},
  {z:13,s:"Al",n:"Aluminium",m:"26.982",g:13,p:3},{z:14,s:"Si",n:"Silicon",m:"28.086",g:14,p:3},
  {z:15,s:"P",n:"Phosphorus",m:"30.974",g:15,p:3},{z:16,s:"S",n:"Sulfur",m:"32.065",g:16,p:3},
  {z:17,s:"Cl",n:"Chlorine",m:"35.453",g:17,p:3},{z:18,s:"Ar",n:"Argon",m:"39.948",g:18,p:3},
  {z:19,s:"K",n:"Potassium",m:"39.098",g:1,p:4},{z:20,s:"Ca",n:"Calcium",m:"40.078",g:2,p:4},
  {z:21,s:"Sc",n:"Scandium",m:"44.956",g:3,p:4},{z:22,s:"Ti",n:"Titanium",m:"47.867",g:4,p:4},
  {z:23,s:"V",n:"Vanadium",m:"50.942",g:5,p:4},{z:24,s:"Cr",n:"Chromium",m:"51.996",g:6,p:4},
  {z:25,s:"Mn",n:"Manganese",m:"54.938",g:7,p:4},{z:26,s:"Fe",n:"Iron",m:"55.845",g:8,p:4},
  {z:27,s:"Co",n:"Cobalt",m:"58.933",g:9,p:4},{z:28,s:"Ni",n:"Nickel",m:"58.693",g:10,p:4},
  {z:29,s:"Cu",n:"Copper",m:"63.546",g:11,p:4},{z:30,s:"Zn",n:"Zinc",m:"65.38",g:12,p:4},
  {z:31,s:"Ga",n:"Gallium",m:"69.723",g:13,p:4},{z:32,s:"Ge",n:"Germanium",m:"72.630",g:14,p:4},
  {z:33,s:"As",n:"Arsenic",m:"74.922",g:15,p:4},{z:34,s:"Se",n:"Selenium",m:"78.971",g:16,p:4},
  {z:35,s:"Br",n:"Bromine",m:"79.904",g:17,p:4},{z:36,s:"Kr",n:"Krypton",m:"83.798",g:18,p:4},
  {z:47,s:"Ag",n:"Silver",m:"107.868",g:11,p:5},{z:50,s:"Sn",n:"Tin",m:"118.710",g:14,p:5},
  {z:53,s:"I",n:"Iodine",m:"126.904",g:17,p:5},{z:56,s:"Ba",n:"Barium",m:"137.327",g:2,p:6},
  {z:78,s:"Pt",n:"Platinum",m:"195.084",g:10,p:6},{z:79,s:"Au",n:"Gold",m:"196.967",g:11,p:6},
  {z:80,s:"Hg",n:"Mercury",m:"200.592",g:12,p:6},{z:82,s:"Pb",n:"Lead",m:"207.2",g:14,p:6},
];
const ELEMENT_BY_SYMBOL = Object.fromEntries(ELEMENT_DATA.map(e => [e.s, e]));

function MoleculeContent({ block, onUpdate, onSelect }: {
  block: MoleculeBlock;
  onUpdate: (id: string, p: Patch) => void;
  onSelect?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.innerHTML = "";
    if (!block.smiles.trim()) { setError(null); return; }
    try {
      const drawer = new (SmilesDrawer as any).SvgDrawer({
        width: block.width - 20,
        height: block.height - 72,
        padding: 16,
        bondThickness: 1.1,
        fontSizeLarge: 13,
        fontSizeSmall: 9,
      });
      (SmilesDrawer as any).parse(block.smiles, (tree: any) => {
        drawer.draw(tree, el, "light", false);
        setError(null);
      }, (_err: any) => {
        el.innerHTML = "";
        setError("Invalid SMILES");
      });
    } catch {
      el.innerHTML = "";
      setError("Invalid SMILES");
    }
  }, [block.smiles, block.width, block.height]);

  return (
    <div className="chem-block-content" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
      <div className="chem-input-row" onPointerDown={e => e.stopPropagation()}>
        <input
          className="chem-smiles-input"
          value={block.smiles}
          onChange={e => onUpdate(block.id, { smiles: e.target.value })}
          onDoubleClick={e => e.stopPropagation()}
          placeholder="SMILES (e.g. c1ccccc1)"
          spellCheck={false}
        />
      </div>
      {!block.smiles.trim()
        ? <div className="chem-empty">Enter a SMILES string above<br/><span className="chem-hint">e.g. c1ccccc1 (benzene) · CCO (ethanol) · CC(=O)O (acetic acid)</span></div>
        : error
          ? <div className="chem-error">{error}</div>
          : null
      }
      <svg ref={svgRef} className="chem-molecule-svg" style={(!block.smiles.trim() || !!error) ? { display: "none" } : {}} />
      <div className="chem-label-row" onPointerDown={e => e.stopPropagation()}>
        <input
          className="chem-label-input"
          value={block.label}
          onChange={e => onUpdate(block.id, { label: e.target.value })}
          onDoubleClick={e => e.stopPropagation()}
          placeholder="Label (optional)…"
        />
      </div>
    </div>
  );
}

function ChemEqContent({ block, onUpdate, onSelect }: {
  block: ChemEqBlock;
  onUpdate: (id: string, p: Patch) => void;
  onSelect?: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (!el || !block.formula.trim()) { setRenderError(null); return; }
    try {
      katex.render(`\\ce{${block.formula}}`, el, { throwOnError: true, displayMode: true });
      setRenderError(null);
    } catch (e: any) {
      el.innerHTML = "";
      setRenderError(e.message?.split('\n')[0] ?? "Parse error");
    }
  }, [block.formula]);

  return (
    <div className="chem-block-content" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
      {!block.preview && (
        <div className="chem-input-row" onPointerDown={e => e.stopPropagation()}>
          <input
            className="chem-smiles-input"
            value={block.formula}
            onChange={e => onUpdate(block.id, { formula: e.target.value })}
            onDoubleClick={e => e.stopPropagation()}
            placeholder="e.g. 2H2 + O2 -> 2H2O"
            spellCheck={false}
          />
        </div>
      )}
      <div className="chem-eq-render" onPointerDown={e => e.stopPropagation()}>
        {!block.formula.trim() && <div className="chem-empty">Enter a chemical equation above</div>}
        {renderError && <div className="chem-error">{renderError}</div>}
        <div ref={previewRef} className={renderError || !block.formula.trim() ? "chem-hidden" : ""} />
      </div>
      <div className="chem-label-row" onPointerDown={e => e.stopPropagation()}>
        <input
          className="chem-label-input"
          value={block.label}
          onChange={e => onUpdate(block.id, { label: e.target.value })}
          onDoubleClick={e => e.stopPropagation()}
          placeholder="Label (optional)…"
        />
      </div>
    </div>
  );
}

function ElementContent({ block, onUpdate, onSelect }: {
  block: ElementBlock;
  onUpdate: (id: string, p: Patch) => void;
  onSelect?: () => void;
}) {
  const el = ELEMENT_BY_SYMBOL[block.symbol];
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? ELEMENT_DATA.filter(e =>
        e.s.toLowerCase().includes(search.toLowerCase()) ||
        e.n.toLowerCase().includes(search.toLowerCase()) ||
        String(e.z).includes(search)
      )
    : ELEMENT_DATA;

  if (editing) {
    return (
      <div className="chem-block-content" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
        <div className="chem-input-row" onPointerDown={e => e.stopPropagation()}>
          <input
            className="chem-smiles-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            placeholder="Search element…"
            onDoubleClick={e => e.stopPropagation()}
          />
        </div>
        <div className="chem-element-list" onPointerDown={e => e.stopPropagation()}>
          {filtered.slice(0, 20).map(e => (
            <button key={e.s} className="chem-element-option" onClick={() => {
              onUpdate(block.id, { symbol: e.s });
              setEditing(false);
              setSearch("");
            }}>
              <span className="chem-eo-z">{e.z}</span>
              <span className="chem-eo-sym">{e.s}</span>
              <span className="chem-eo-name">{e.n}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!el) return <div className="chem-empty" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>Unknown element</div>;

  const cpkColors: Record<string, string> = {
    H:"#FFFFFF",C:"#404040",N:"#4169E1",O:"#FF4444",F:"#DAA520",P:"#FF8000",
    S:"#FFFF30",Cl:"#1FF01F",Br:"#A52A2A",I:"#940094",Na:"#AB5CF2",K:"#8F40D4",
    Ca:"#3DFF00",Fe:"#E06633",Cu:"#C88033",Zn:"#7D80B0",default:"#FF69B4",
  };
  const cpk = cpkColors[el.s] ?? cpkColors.default;

  return (
    <div className="chem-element-card" style={{ "--cpk": cpk } as React.CSSProperties}
      onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={e => { e.stopPropagation(); setEditing(true); }}>
      <div className="chem-ec-z">{el.z}</div>
      <div className="chem-ec-sym">{el.s}</div>
      <div className="chem-ec-name">{el.n}</div>
      <div className="chem-ec-mass">{el.m}</div>
      <div className="chem-ec-meta">Period {el.p} · Group {el.g}</div>
    </div>
  );
}

// ── SQL engine (sql.js / SQLite WASM) ───────────────────────────────────────────
// One in-memory SQLite database per session ID — mirrors the Python session model.
// Sessions survive re-renders and accumulate schema/data until explicitly reset.

let _sqlJs: SqlJsStatic | null = null;
const _sqlSessions = new Map<string, Database>();

interface SqlTableData { columns: string[]; rows: (string | null)[][]; rowCount: number; }

async function _getSqlJs(): Promise<SqlJsStatic> {
  if (!_sqlJs) _sqlJs = await initSqlJs({ locateFile: () => sqlWasmUrl });
  return _sqlJs;
}

async function _getSqlDb(sessionId: string): Promise<Database> {
  if (!_sqlSessions.has(sessionId)) {
    const SQL = await _getSqlJs();
    _sqlSessions.set(sessionId, new SQL.Database());
  }
  return _sqlSessions.get(sessionId)!;
}

function _resetSqlSession(sessionId: string) {
  _sqlSessions.get(sessionId)?.close();
  _sqlSessions.delete(sessionId);
}

async function runSqlCode(sessionId: string, sql: string): Promise<OutputChunk[]> {
  try {
    const db = await _getSqlDb(sessionId);
    const results = db.exec(sql);
    const data: SqlTableData[] = results.map(({ columns, values }) => ({
      columns,
      rows: values.map(row => row.map(v => (v == null ? null : String(v)))),
      rowCount: values.length,
    }));
    return [{ type: "table", content: JSON.stringify(data) }];
  } catch (err: unknown) {
    return [{ type: "error", content: err instanceof Error ? err.message : String(err) }];
  }
}

function SqlResultTable({ content }: { content: string }) {
  const data: SqlTableData[] = JSON.parse(content);
  if (data.length === 0) return <pre className="code-cell-sql-ok">✓ OK</pre>;
  return (
    <>
      {data.map((res, ri) => (
        <div key={ri} className="sql-result-set">
          <div className="sql-table-scroll">
            <table className="sql-result-table">
              <thead>
                <tr>{res.columns.map((c, ci) => <th key={ci}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {res.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((v, ci) => (
                      <td key={ci}>{v === null ? <span className="sql-null">NULL</span> : v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="sql-row-count">{res.rowCount} row{res.rowCount !== 1 ? 's' : ''}</span>
        </div>
      ))}
    </>
  );
}

// ── CodeCellContent ─────────────────────────────────────────────────────────────

interface CodeCellProps {
  block: CodeCellBlock;
  sessionId: string | undefined;
  onUpdate: (patch: Partial<CodeCellBlock>) => void;
  onRunAll: () => Promise<void>;
  onRestart: () => void;
  onSelect?: () => void;
}

function CodeCellContent({ block, sessionId, onUpdate, onRunAll, onRestart, onSelect }: CodeCellProps) {
  const [codeHeight, setCodeHeight] = useState(120);
  const splitterDrag = useRef<{ startY: number; startH: number } | null>(null);

  const lang = block.language ?? "python";

  async function runSingle() {
    if (!sessionId) {
      onUpdate({ outputs: [{ type: "error", content: "No session ID — open this canvas from a saved note." }] });
      return;
    }
    onUpdate({ running: true, outputs: [] });
    try {
      let outputs: OutputChunk[];
      if (lang === "sql") {
        outputs = await runSqlCode(sessionId, block.code);
      } else {
        const result = await invoke<{ chunks: { type: string; content: string }[] }>(
          "run_python", { sessionId, code: block.code }
        );
        outputs = result.chunks as OutputChunk[];
      }
      onUpdate({ running: false, outputs });
    } catch (e) {
      const msg = String(e);
      const isUnknownCmd = msg.includes("Unknown command") || msg.includes("unknown command");
      onUpdate({
        running: false,
        outputs: [{
          type: "error",
          content: isUnknownCmd && lang === "python"
            ? "Python is not available on this device.\nSwitch the cell to SQL to run queries, or use the desktop app for Python."
            : msg,
        }],
      });
    }
  }

  function onSplitterPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    splitterDrag.current = { startY: e.clientY, startH: codeHeight };
    function onMove(ev: PointerEvent) {
      if (!splitterDrag.current) return;
      const dy = ev.clientY - splitterDrag.current.startY;
      setCodeHeight(Math.max(48, splitterDrag.current.startH + dy));
    }
    function onUp() {
      splitterDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const outputs = block.outputs ?? [];
  const hasOutput = outputs.length > 0;

  return (
    <div className="code-cell-wrap" onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}>
      <div className="code-cell-toolbar">
        <button className="code-cell-btn code-cell-run" onClick={e => { e.stopPropagation(); runSingle(); }} disabled={block.running} title="Run cell (Shift+Enter)">▶</button>
        <button className="code-cell-btn code-cell-run-all" onClick={e => { e.stopPropagation(); onRunAll(); }} disabled={block.running} title="Run all cells in order">⏩</button>
        <button className="code-cell-btn code-cell-restart" onClick={e => { e.stopPropagation(); onRestart(); }} title="Restart kernel — clears all variables">↺</button>
        <button
          className={`code-cell-lang-btn${lang === "sql" ? " sql" : ""}`}
          onClick={e => { e.stopPropagation(); onUpdate({ language: lang === "python" ? "sql" : "python", outputs: [] }); }}
          title={lang === "sql" ? "SQL (SQLite) — click to switch to Python" : "Python — click to switch to SQL"}
        >
          {lang === "sql" ? "SQL" : "Python"}
        </button>
        {block.running && <span className="code-cell-spinner">⬤</span>}
      </div>
      <textarea
        className="code-cell-input"
        style={{ height: hasOutput ? codeHeight : undefined, flex: hasOutput ? "none" : "1" }}
        value={block.code}
        onChange={e => onUpdate({ code: e.target.value })}
        onPaste={handleNativePaste}
        onPointerDown={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); runSingle(); }
        }}
        spellCheck={false}
        placeholder={lang === "sql"
          ? "-- SQL (SQLite)…  Shift+Enter to run\n-- e.g. CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);"
          : "# Python…  Shift+Enter to run"}
      />
      {hasOutput && (
        <>
          <div className="code-cell-splitter" onPointerDown={onSplitterPointerDown} />
          <div className="code-cell-output">
            {outputs.map((chunk, i) =>
              chunk.type === "table"
                ? <SqlResultTable key={i} content={chunk.content} />
                : chunk.type === "image"
                  ? <img key={i} src={`data:image/png;base64,${chunk.content}`} alt="cell output" className="code-cell-img" />
                  : chunk.type === "html"
                    ? <iframe key={i} srcDoc={chunk.content} sandbox="allow-scripts"
                        className="code-cell-html-frame" title="output" />
                    : <pre key={i} className={chunk.type === "error" ? "code-cell-error-text" : ""}>{chunk.content}</pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── HtmlContent ────────────────────────────────────────────────────────────────

function HtmlContent({ block, onUpdate, onSelect }: {
  block: HtmlBlock;
  onUpdate: (id: string, patch: Patch) => void;
  onSelect?: () => void;
}) {
  if (block.preview) {
    return (
      <iframe
        srcDoc={block.code}
        sandbox="allow-scripts"
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0, display: "block" }}
        title="HTML preview"
      />
    );
  }
  return (
    <textarea
      className="code-cell-input html-block-input"
      value={block.code}
      onChange={e => onUpdate(block.id, { code: e.target.value })}
      onPaste={handleNativePaste}
      onPointerDown={e => { e.stopPropagation(); onSelect?.(); }}
      onDoubleClick={e => e.stopPropagation()}
      spellCheck={false}
      placeholder={"<!DOCTYPE html>\n<html>\n  <!-- paste your simulation here -->\n</html>"}
    />
  );
}

// ── Interactive molecule draw ──────────────────────────────────────────────────

const MOL_CPK: Record<string, string> = {
  C: "#1e293b", H: "#e2e8f0", N: "#3050f8", O: "#ef4444",
  S: "#ca8a04", P: "#ea580c", F: "#65a30d", Cl: "#16a34a",
  Br: "#9f1239", I: "#7e22ce",
};
const MOL_CPK_TEXT: Record<string, string> = {
  H: "#1e293b", F: "#ffffff", S: "#ffffff", Cl: "#ffffff",
};
const MOL_ELEM_PALETTE = ["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "I"];
// Bond length for snapping (px in SVG coords)
const BOND_LEN = 52;
// Hit radius for mouse detection
const MOL_HIT_R = 14;
// Visual radius: C = small dot, others = labelled circle
const MOL_VIS_R = (sym: string) => sym === "C" ? 4 : 13;

// Snap a drag endpoint: fixed bond length, nearest 30° angle
function snapBondEnd(fx: number, fy: number, mx: number, my: number): { x: number; y: number } {
  const dx = mx - fx, dy = my - fy;
  if (Math.hypot(dx, dy) < 6) return { x: mx, y: my };
  const raw = Math.atan2(dy, dx);
  const snapped = Math.round(raw / (Math.PI / 6)) * (Math.PI / 6);
  return { x: fx + Math.cos(snapped) * BOND_LEN, y: fy + Math.sin(snapped) * BOND_LEN };
}

// Return suggested next-bond angles given the bonds already on an atom
function suggestedAngles(atomId: string, atoms: MolAtom[], bonds: MolBond[]): number[] {
  const a = atoms.find(x => x.id === atomId);
  if (!a) return [];
  const existing: number[] = bonds
    .filter(b => b.from === atomId || b.to === atomId)
    .map(b => {
      const other = atoms.find(x => x.id === (b.from === atomId ? b.to : b.from));
      return other ? Math.atan2(other.y - a.y, other.x - a.x) : null;
    })
    .filter((v): v is number => v !== null);

  if (existing.length === 0) {
    // No bonds yet — offer 30° and 150° (standard chain start)
    return [Math.PI / 6, (5 * Math.PI) / 6];
  }
  if (existing.length === 1) {
    // One bond at angle θ: suggest θ+60° and θ-60° (zigzag chain)
    return [existing[0] + Math.PI / 3, existing[0] - Math.PI / 3];
  }
  // Multiple bonds: suggest the largest gap bisector
  const sorted = [...existing].sort((a, b) => a - b);
  let maxGap = 0, bisector = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const gap = ((next - sorted[i] + 2 * Math.PI) % (2 * Math.PI));
    if (gap > maxGap) { maxGap = gap; bisector = sorted[i] + gap / 2; }
  }
  return [bisector];
}

function MolDrawContent({ block, onUpdate, onSelect }: {
  block: MolDrawBlock;
  onUpdate: (id: string, p: Patch) => void;
  onSelect?: () => void;
}) {
  const [activeElem, setActiveElem] = useState("C");
  const [drawTool, setDrawTool] = useState<"draw" | "erase">("draw");
  const [selAtomId, setSelAtomId] = useState<string | null>(null);
  const [selBondId, setSelBondId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<{ id: string; x: number; y: number } | null>(null);
  // snapped preview endpoint while dragging
  const [snapPt, setSnapPt] = useState<{ x: number; y: number } | null>(null);
  const [hovAtomId, setHovAtomId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { atoms, bonds } = block;

  function toSvg(e: React.PointerEvent): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function atomAt(x: number, y: number, skip?: string): MolAtom | null {
    for (const a of atoms) {
      if (a.id === skip) continue;
      if ((a.x - x) ** 2 + (a.y - y) ** 2 < MOL_HIT_R ** 2) return a;
    }
    return null;
  }

  function bondAt(x: number, y: number): MolBond | null {
    for (const b of bonds) {
      const fa = atoms.find(a => a.id === b.from);
      const ta = atoms.find(a => a.id === b.to);
      if (!fa || !ta) continue;
      const dx = ta.x - fa.x, dy = ta.y - fa.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - fa.x) * dx + (y - fa.y) * dy) / len2));
      const px = fa.x + t * dx - x, py = fa.y + t * dy - y;
      if (px * px + py * py < 36) return b;
    }
    return null;
  }

  function onSvgDown(e: React.PointerEvent<SVGSVGElement>) {
    e.stopPropagation();
    onSelect?.();
    const pt = toSvg(e);
    dragStartRef.current = pt;

    if (drawTool === "erase") {
      const ha = atomAt(pt.x, pt.y);
      if (ha) {
        onUpdate(block.id, {
          atoms: atoms.filter(a => a.id !== ha.id),
          bonds: bonds.filter(b => b.from !== ha.id && b.to !== ha.id),
        });
      } else {
        const hb = bondAt(pt.x, pt.y);
        if (hb) onUpdate(block.id, { bonds: bonds.filter(b => b.id !== hb.id) });
      }
      return;
    }

    const ha = atomAt(pt.x, pt.y);
    if (ha) {
      setDragFrom({ id: ha.id, x: ha.x, y: ha.y });
      setSelAtomId(ha.id);
      setSelBondId(null);
    }
  }

  function onSvgMove(e: React.PointerEvent<SVGSVGElement>) {
    const pt = toSvg(e);
    if (dragFrom) {
      const snapped = snapBondEnd(dragFrom.x, dragFrom.y, pt.x, pt.y);
      const hitTarget = atomAt(snapped.x, snapped.y, dragFrom.id) ?? atomAt(pt.x, pt.y, dragFrom.id);
      setSnapPt(hitTarget ? { x: hitTarget.x, y: hitTarget.y } : snapped);
      setHovAtomId(hitTarget?.id ?? null);
    } else {
      setHovAtomId(atomAt(pt.x, pt.y)?.id ?? null);
    }
  }

  function onSvgUp(e: React.PointerEvent<SVGSVGElement>) {
    const pt = toSvg(e);
    const ds = dragStartRef.current;
    const wasDrag = ds != null && Math.hypot(pt.x - ds.x, pt.y - ds.y) > 6;
    dragStartRef.current = null;

    if (drawTool === "erase") { setDragFrom(null); setSnapPt(null); return; }

    if (dragFrom) {
      const snapped = snapBondEnd(dragFrom.x, dragFrom.y, pt.x, pt.y);
      const target = atomAt(snapped.x, snapped.y, dragFrom.id) ?? atomAt(pt.x, pt.y, dragFrom.id);
      if (target) {
        const existing = bonds.find(b =>
          (b.from === dragFrom.id && b.to === target.id) ||
          (b.from === target.id && b.to === dragFrom.id)
        );
        if (existing) {
          const next = existing.order === 1 ? 2 : existing.order === 2 ? 3 : 1;
          onUpdate(block.id, { bonds: bonds.map(b => b.id === existing.id ? { ...b, order: next as 1|2|3 } : b) });
        } else {
          onUpdate(block.id, { bonds: [...bonds, { id: uid(), from: dragFrom.id, to: target.id, order: 1 } as MolBond] });
        }
      } else if (wasDrag) {
        // Place new atom at snapped position
        const newAtom: MolAtom = { id: uid(), symbol: activeElem, x: snapped.x, y: snapped.y };
        const newBond: MolBond = { id: uid(), from: dragFrom.id, to: newAtom.id, order: 1 };
        onUpdate(block.id, { atoms: [...atoms, newAtom], bonds: [...bonds, newBond] });
        setSelAtomId(newAtom.id);
      } else {
        // Pure click on atom: change element if different
        const src = atoms.find(a => a.id === dragFrom.id);
        if (src && src.symbol !== activeElem) {
          onUpdate(block.id, { atoms: atoms.map(a => a.id === dragFrom.id ? { ...a, symbol: activeElem } : a) });
        }
      }
    } else if (!wasDrag) {
      const ha = atomAt(pt.x, pt.y);
      const hb = bondAt(pt.x, pt.y);
      if (!ha && !hb) {
        const newAtom: MolAtom = { id: uid(), symbol: activeElem, x: pt.x, y: pt.y };
        onUpdate(block.id, { atoms: [...atoms, newAtom] });
        setSelAtomId(newAtom.id);
        setSelBondId(null);
      } else if (hb && !ha) {
        const next = hb.order === 1 ? 2 : hb.order === 2 ? 3 : 1;
        onUpdate(block.id, { bonds: bonds.map(b => b.id === hb.id ? { ...b, order: next as 1|2|3 } : b) });
        setSelBondId(hb.id);
        setSelAtomId(null);
      }
    }

    setDragFrom(null);
    setSnapPt(null);
    setHovAtomId(null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (selAtomId) {
      onUpdate(block.id, {
        atoms: atoms.filter(a => a.id !== selAtomId),
        bonds: bonds.filter(b => b.from !== selAtomId && b.to !== selAtomId),
      });
      setSelAtomId(null);
    } else if (selBondId) {
      onUpdate(block.id, { bonds: bonds.filter(b => b.id !== selBondId) });
      setSelBondId(null);
    }
  }

  function renderBond(bond: MolBond) {
    const fa = atoms.find(a => a.id === bond.from);
    const ta = atoms.find(a => a.id === bond.to);
    if (!fa || !ta) return null;
    const dx = ta.x - fa.x, dy = ta.y - fa.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const rA = MOL_VIS_R(fa.symbol), rB = MOL_VIS_R(ta.symbol);
    const sx = fa.x + ux * (rA + 2), sy = fa.y + uy * (rA + 2);
    const ex = ta.x - ux * (rB + 2), ey = ta.y - uy * (rB + 2);
    const isSel = bond.id === selBondId;
    const stroke = isSel ? "#f59e0b" : "#1e293b";
    const sw = 2;
    if (bond.order === 1) {
      return <line key={bond.id} x1={sx} y1={sy} x2={ex} y2={ey} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />;
    }
    const d = 3.5;
    if (bond.order === 2) return (
      <g key={bond.id}>
        <line x1={sx+nx*d} y1={sy+ny*d} x2={ex+nx*d} y2={ey+ny*d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <line x1={sx-nx*d} y1={sy-ny*d} x2={ex-nx*d} y2={ey-ny*d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </g>
    );
    return (
      <g key={bond.id}>
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <line x1={sx+nx*d} y1={sy+ny*d} x2={ex+nx*d} y2={ey+ny*d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <line x1={sx-nx*d} y1={sy-ny*d} x2={ex-nx*d} y2={ey-ny*d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </g>
    );
  }

  function renderAtom(atom: MolAtom) {
    const isSel = atom.id === selAtomId;
    const isDragSrc = atom.id === dragFrom?.id;
    const isHov = atom.id === hovAtomId;
    const isC = atom.symbol === "C";
    const r = MOL_VIS_R(atom.symbol);
    const ringColor = isSel ? "#f59e0b" : (isDragSrc || isHov) ? "#60a5fa" : null;

    if (isC) {
      // Carbon: small dot, no label; show ring only when selected/hovered
      return (
        <circle key={atom.id} cx={atom.x} cy={atom.y} r={r}
          fill={ringColor ? "transparent" : "#1e293b"}
          stroke={ringColor ?? "#1e293b"}
          strokeWidth={ringColor ? 2 : 0}
        />
      );
    }

    const bg = MOL_CPK[atom.symbol] ?? "#606060";
    const fg = MOL_CPK_TEXT[atom.symbol] ?? "#ffffff";
    // White background behind text to clear any bond lines passing through
    return (
      <g key={atom.id}>
        <circle cx={atom.x} cy={atom.y} r={r + 2}
          fill="var(--bg-raised)" stroke="none" />
        <circle cx={atom.x} cy={atom.y} r={r}
          fill={bg}
          stroke={ringColor ?? "none"}
          strokeWidth={ringColor ? 2.5 : 0}
        />
        <text x={atom.x} y={atom.y}
          textAnchor="middle" dominantBaseline="central"
          fontSize={atom.symbol.length > 1 ? 8 : 11}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
          fill={fg}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >{atom.symbol}</text>
      </g>
    );
  }

  // Ghost bond suggestions shown when hovering an atom (draw tool, not dragging)
  const ghostAngles = (!dragFrom && drawTool === "draw" && hovAtomId)
    ? suggestedAngles(hovAtomId, atoms, bonds)
    : [];
  const ghostAtom = hovAtomId ? atoms.find(a => a.id === hovAtomId) : null;

  return (
    <div className="moldraw-wrap" tabIndex={-1} onKeyDown={onKeyDown}
      onPointerDown={e => e.stopPropagation()}>
      <div className="moldraw-toolbar" onPointerDown={e => e.stopPropagation()}>
        <div className="moldraw-elem-row">
          {MOL_ELEM_PALETTE.map(el => (
            <button key={el}
              className={`moldraw-elem-btn${activeElem === el ? " md-active" : ""}`}
              style={{ background: el === "C" ? "#1e293b" : (MOL_CPK[el] ?? "#606060"), color: MOL_CPK_TEXT[el] ?? "#fff" }}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setActiveElem(el); setDrawTool("draw"); }}
            >{el}</button>
          ))}
        </div>
        <div className="moldraw-actions">
          <button className={`moldraw-action-btn${drawTool === "draw" ? " md-active" : ""}`}
            title="Draw — drag from atom to extend chain (snaps to 30° angles)"
            onClick={() => setDrawTool("draw")}>✏</button>
          <button className={`moldraw-action-btn${drawTool === "erase" ? " md-active" : ""}`}
            title="Erase atom or bond"
            onClick={() => setDrawTool("erase")}>⌫</button>
          <button className="moldraw-action-btn" title="Clear all"
            onClick={() => { onUpdate(block.id, { atoms: [], bonds: [] }); setSelAtomId(null); setSelBondId(null); }}>⊗</button>
        </div>
      </div>
      <svg ref={svgRef}
        className={`moldraw-svg${drawTool === "erase" ? " md-erase" : ""}`}
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerLeave={() => { setDragFrom(null); setSnapPt(null); setHovAtomId(null); }}
      >
        {/* Ghost bond direction hints */}
        {ghostAtom && ghostAngles.map((angle, i) => (
          <line key={i}
            x1={ghostAtom.x} y1={ghostAtom.y}
            x2={ghostAtom.x + Math.cos(angle) * BOND_LEN}
            y2={ghostAtom.y + Math.sin(angle) * BOND_LEN}
            stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3"
            opacity={0.5} pointerEvents="none"
          />
        ))}

        {bonds.map(b => renderBond(b))}

        {/* Bond preview while dragging — snapped */}
        {dragFrom && snapPt && (
          <>
            <line x1={dragFrom.x} y1={dragFrom.y} x2={snapPt.x} y2={snapPt.y}
              stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 3" pointerEvents="none" />
            <circle cx={snapPt.x} cy={snapPt.y} r={5}
              fill="#60a5fa" opacity={0.6} pointerEvents="none" />
          </>
        )}

        {atoms.map(a => renderAtom(a))}

        {atoms.length === 0 && (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
            fontSize={12} fill="#94a3b8" style={{ pointerEvents: "none" }}>
            Click to place atom · drag to extend chain
          </text>
        )}
      </svg>
      <input className="moldraw-caption"
        value={block.label}
        onChange={e => onUpdate(block.id, { label: e.target.value })}
        onPointerDown={e => e.stopPropagation()}
        placeholder="Molecule name…"
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { content: string; onChange: (content: string) => void; nodeId?: string; }

export function CanvasEditor({ content, onChange, nodeId }: Props) {
  const [data,           setData]           = useState<CanvasData>(() => parseData(content));
  const [viewport,       setViewport]       = useState({ x: 0, y: 0, zoom: 1 });
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [selectedArrowId,setSelectedArrowId]= useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [pendingArrow,   setPendingArrow]   = useState<PendingArrow | null>(null);
  const [previewPos,     setPreviewPos]     = useState<{ x: number; y: number } | null>(null);
  const [tool,           setTool]           = useState<"pan" | "lasso" | "draw_arrow" | "draw_ellipse" | "draw_polygon">("pan");
  const [buildMode,      setBuildMode]      = useState(false);
  const [lassoRect,      setLassoRect]      = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [snapGuides,     setSnapGuides]     = useState<SnapGuide[]>([]);
  const [showOverview,   setShowOverview]   = useState(false);
  const [arrowHoverPos,  setArrowHoverPos]  = useState<{ arrowId: string; x: number; y: number } | null>(null);
  const [contextMenu,    setContextMenu]    = useState<{ x: number; y: number; blockId: string } | null>(null);
  const [showToolbar,    setShowToolbar]    = useState(false);
  const [openMenu,       setOpenMenu]       = useState<string | null>(null);
  const toolbarHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef     = useRef<HTMLDivElement>(null);
  const panEndTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPanInit        = useRef(true);
  const undoStack        = useRef<CanvasData[]>([]);
  const redoStack        = useRef<CanvasData[]>([]);
  const preDragSnapshot  = useRef<CanvasData | null>(null);
  const preResizeSnapshot = useRef<CanvasData | null>(null);
  const preDividerSnapshot = useRef<CanvasData | null>(null);
  const isPanning        = useRef(false);
  const panStart         = useRef({ mx: 0, my: 0, vx: 0, vy: 0 });
  const dragBlock        = useRef<{
    id: string; mx: number; my: number; ox: number; oy: number;
    width: number; height: number;
    others: Array<{ id: string; ox: number; oy: number; isDiv?: boolean; ox2?: number; oy2?: number }>;
  } | null>(null);
  const resizeBlock      = useRef<{ id: string; mx: number; my: number; ow: number; oh: number } | null>(null);
  const dragDivider      = useRef<{
    id: string; mode: "line" | "p1" | "p2";
    mx: number; my: number; ox: number; oy: number; ox2: number; oy2: number;
  } | null>(null);
  const dragDrawArrow    = useRef<{
    id: string; mode: "line" | "p1" | "p2";
    mx: number; my: number; ox: number; oy: number; ox2: number; oy2: number;
  } | null>(null);
  const dragDrawShape    = useRef<{
    id: string; mx: number; my: number; ox: number; oy: number;
    // for polygon: original points snapshot
    opts?: { x: number; y: number }[];
  } | null>(null);
  const preDrawSnapshot  = useRef<CanvasData | null>(null);
  const dragWaypoint     = useRef<{
    arrowId: string; waypointId: string;
    mx: number; my: number; ox: number; oy: number;
  } | null>(null);
  const preWaypointSnapshot = useRef<CanvasData | null>(null);
  const lassoStart       = useRef<{ cx: number; cy: number } | null>(null);
  const lassoEnd         = useRef<{ cx: number; cy: number } | null>(null);
  const drawStart        = useRef<{ cx: number; cy: number } | null>(null);
  const [drawCurrent,    setDrawCurrent]    = useState<{ cx: number; cy: number } | null>(null);
  const [polygonPts,     setPolygonPts]     = useState<{ x: number; y: number }[]>([]);
  const viewportRef      = useRef(viewport);
  viewportRef.current    = viewport;
  const selectedIdRef    = useRef(selectedId);
  selectedIdRef.current  = selectedId;
  const selectedIdsRef   = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const selectedArrRef   = useRef(selectedArrowId);
  selectedArrRef.current = selectedArrowId;
  const pendingRef       = useRef(pendingArrow);
  pendingRef.current     = pendingArrow;
  const buildModeRef     = useRef(buildMode);
  buildModeRef.current   = buildMode;
  const [inkMode,        setInkMode]        = useState(false);
  const inkModeRef       = useRef(inkMode);
  inkModeRef.current     = inkMode;
  const [inkColor,       setInkColor]       = useState(DRAW_COLORS[0]);
  const [inkWidth,       setInkWidth]       = useState(2.5);
  const inkActive        = useRef<{ x: number; y: number }[] | null>(null);
  const [inkPreview,     setInkPreview]     = useState<string | null>(null);
  const dataRef          = useRef(data);
  dataRef.current        = data;
  const lastSaved        = useRef(content);

  const touchStartRef    = useRef<{ dist: number; midX: number; midY: number } | null>(null);

  const imageInputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (content !== lastSaved.current) {
      lastSaved.current = content;
      setData(parseData(content));
      setSelectedId(null);
      setSelectedIds(new Set());
      setSelectedArrowId(null);
      setPendingArrow(null);
      setViewport({ x: 0, y: 0, zoom: 1 });
    }
  }, [content]);

  useEffect(() => {
    const t = setTimeout(() => {
      const json = JSON.stringify(data);
      lastSaved.current = json;
      onChange(json);
    }, 300);
    return () => clearTimeout(t);
  }, [data]);

  // Content bounds for navigation panels
  const contentBounds = useMemo(() => getContentBounds(data.blocks), [data.blocks]);

  // Pan overview: show on pan, hide after 1.5s idle
  useEffect(() => {
    if (isPanInit.current) { isPanInit.current = false; return; }
    setShowOverview(true);
    if (panEndTimer.current) clearTimeout(panEndTimer.current);
    panEndTimer.current = setTimeout(() => setShowOverview(false), 1500);
    return () => { if (panEndTimer.current) clearTimeout(panEndTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.x, viewport.y]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.shiftKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // Proportional zoom: scales with gesture speed, capped so no single event
        // jumps more than ~6%. Gives smooth trackpad pinch and gentle mouse wheel.
        const capped = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.003, 0.06);
        const factor = Math.exp(-capped);
        setViewport(vp => {
          const nz = Math.max(0.15, Math.min(4, vp.zoom * factor));
          return { zoom: nz, x: mx - (mx - vp.x) * nz / vp.zoom, y: my - (my - vp.y) * nz / vp.zoom };
        });
      } else {
        setViewport(vp => ({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Copy / Paste ─────────────────────────────────────────────────────────────

  function deepCloneBlock(block: CanvasBlock): CanvasBlock {
    const clone = JSON.parse(JSON.stringify(block)) as CanvasBlock;
    clone.id = uid();
    if (clone.type === "kanban") {
      clone.columns = clone.columns.map(col => ({
        ...col, id: uid(), cards: col.cards.map(card => ({ ...card, id: uid() })),
      }));
    }
    if (clone.type === "checklist") {
      clone.items = clone.items.map(item => ({ ...item, id: uid() }));
    }
    return clone;
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────────────

  function snapshotData(): CanvasData {
    const d = dataRef.current;
    return { blocks: [...d.blocks], arrows: [...d.arrows] };
  }

  function pushUndo(snapshot?: CanvasData) {
    undoStack.current = [...undoStack.current.slice(-49), snapshot ?? snapshotData()];
    redoStack.current = [];
  }

  function doUndo() {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    redoStack.current = [snapshotData(), ...redoStack.current.slice(0, 49)];
    undoStack.current = undoStack.current.slice(0, -1);
    setData(prev);
    setSelectedId(null); setSelectedIds(new Set()); setSelectedArrowId(null);
  }

  function doRedo() {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[0];
    undoStack.current = [...undoStack.current.slice(-49), snapshotData()];
    redoStack.current = redoStack.current.slice(1);
    setData(next);
    setSelectedId(null); setSelectedIds(new Set()); setSelectedArrowId(null);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setPendingArrow(null);
        setPreviewPos(null);
        setTool("pan");
        lassoStart.current = null;
        lassoEnd.current = null;
        setLassoRect(null);
        drawStart.current = null;
        setDrawCurrent(null);
        setPolygonPts([]);
        inkActive.current = null;
        setInkPreview(null);
        if (selectedIdsRef.current.size > 1) { setSelectedIds(new Set()); setSelectedId(null); }
        return;
      }
      const tag = (document.activeElement as HTMLElement)?.tagName;

      // Enter = finish polygon
      if (e.key === "Enter") {
        const tag2 = (document.activeElement as HTMLElement)?.tagName;
        if (tag2 === "TEXTAREA" || tag2 === "INPUT") return;
        setPolygonPts(pts => {
          if (pts.length < 2) return [];
          pushUndo();
          setData(d => ({ ...d, blocks: [...d.blocks, mkDrawPolygon(pts, true)] }));
          return [];
        });
        return;
      }

      // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (tag === "TEXTAREA" || tag === "INPUT") return; // let native undo handle text fields
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        e.preventDefault();
        doRedo();
        return;
      }

      // Cmd/Ctrl+C = copy selected block(s)
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (tag === "TEXTAREA" || tag === "INPUT") return; // always let native copy work in text inputs
        const ids = selectedIdsRef.current;
        const selId = selectedIdRef.current;
        if (ids.size > 1) {
          sharedCanvasClipboard = dataRef.current.blocks
            .filter(b => ids.has(b.id))
            .map(b => JSON.parse(JSON.stringify(b)));
        } else if (selId) {
          const b = dataRef.current.blocks.find(b => b.id === selId);
          if (b) sharedCanvasClipboard = [JSON.parse(JSON.stringify(b))];
        }
        return;
      }

      // Cmd/Ctrl+V = paste canvas blocks (keydown because WKWebView paste events
      // only fire on editable elements, not on canvas divs)
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        if (!sharedCanvasClipboard?.length) return;
        e.preventDefault();
        pushUndo();
        const OFFSET = 30;
        const newBlocks = sharedCanvasClipboard.map(b => ({
          ...deepCloneBlock(b), x: b.x + OFFSET, y: b.y + OFFSET,
        }));
        // Advance clipboard so repeated pastes cascade
        sharedCanvasClipboard = newBlocks.map(b => JSON.parse(JSON.stringify(b)));
        setData(d => ({ ...d, blocks: [...d.blocks, ...newBlocks] }));
        if (newBlocks.length === 1) {
          setSelectedId(newBlocks[0].id); setSelectedIds(new Set([newBlocks[0].id]));
        } else {
          setSelectedIds(new Set(newBlocks.map(b => b.id))); setSelectedId(null);
        }
        setSelectedArrowId(null);
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (selectedIdsRef.current.size > 1) {
        const ids = selectedIdsRef.current;
        pushUndo();
        setData(d => ({
          ...d,
          blocks: d.blocks.filter(b => !ids.has(b.id)),
          arrows: d.arrows.filter(a => !ids.has(a.fromId) && !ids.has(a.toId)),
        }));
        setSelectedIds(new Set()); setSelectedId(null);
        return;
      }
      const arrowId = selectedArrRef.current;
      if (arrowId) {
        pushUndo();
        setData(d => ({ ...d, arrows: d.arrows.filter(a => a.id !== arrowId) }));
        setSelectedArrowId(null);
        return;
      }
      const id = selectedIdRef.current;
      if (id) {
        pushUndo();
        setData(d => ({
          ...d,
          blocks: d.blocks.filter(b => b.id !== id),
          arrows: d.arrows.filter(a => a.fromId !== id && a.toId !== id),
        }));
        setSelectedId(null); setSelectedIds(new Set());
      }
    };
    // ── Paste (image takes priority over internal block clipboard) ────────────
    const pasteHandler = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find(it => it.type.startsWith("image/"));

      if (imageItem) {
        // System clipboard has an image — always prefer it over stale internal clipboard
        e.preventDefault();
        const blob = imageItem.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result as string;
          const img = new Image();
          img.onload = () => {
            const maxW = 600;
            const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const el = containerRef.current;
            const vp = viewportRef.current;
            const cx = el ? el.offsetWidth  / 2 : 400;
            const cy = el ? el.offsetHeight / 2 : 300;
            const bx = (cx - vp.x) / vp.zoom - w / 2;
            const by = (cy - vp.y) / vp.zoom - h / 2;
            const block = mkImage(bx, by, src, w, h);
            setData(d => ({ ...d, blocks: [...d.blocks, block] }));
            setSelectedId(block.id);
            setSelectedIds(new Set([block.id]));
            setSelectedArrowId(null);
          };
          img.src = src;
        };
        reader.readAsDataURL(blob);
        return;
      }
      // No image — block paste is handled via keydown (WKWebView doesn't fire
      // paste events on non-editable elements, so we can't rely on it here).
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("paste", pasteHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("paste", pasteHandler);
    };
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  // useCallback with [] deps is safe because all reads go through refs or
  // functional setData — no stale-closure risk.

  const updateBlock = useCallback((id: string, patch: Patch) => {
    setData(d => ({ ...d, blocks: d.blocks.map(b => b.id === id ? { ...b, ...patch } as CanvasBlock : b) }));
  }, []);

  const deleteBlock = useCallback((id: string) => {
    pushUndo();
    setData(d => ({
      ...d,
      blocks: d.blocks.filter(b => b.id !== id),
      arrows: d.arrows.filter(a => a.fromId !== id && a.toId !== id),
    }));
    setSelectedId(prev => prev === id ? null : prev);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  function addBlock(factory: (x: number, y: number) => CanvasBlock, sx?: number, sy?: number) {
    pushUndo();
    const el = containerRef.current;
    const vp = viewportRef.current;
    const cx = sx ?? (el ? el.offsetWidth  / 2 : 400);
    const cy = sy ?? (el ? el.offsetHeight / 2 : 300);
    const block = factory((cx - vp.x) / vp.zoom - 150, (cy - vp.y) / vp.zoom - 80);
    setData(d => ({ ...d, blocks: [...d.blocks, block] }));
    setSelectedId(block.id);
    setSelectedIds(new Set([block.id]));
    setSelectedArrowId(null);
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────

  function onBgPointerDown(e: React.PointerEvent) {
    if (!e.isPrimary) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setOpenMenu(null);
    // ── Ink mode routing ──
    if (inkModeRef.current) {
      if (e.pointerType === "touch") return; // suppress single-finger touch
      if (e.pointerType === "pen") {
        const rect = containerRef.current!.getBoundingClientRect();
        const vp = viewportRef.current;
        const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
        const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
        inkActive.current = [{ x: cx, y: cy }];
        setInkPreview(pointsToSmoothPath([{ x: cx, y: cy }]));
        return;
      }
      // mouse: fall through to normal pan/lasso
    }
    if (pendingRef.current) { setPendingArrow(null); setPreviewPos(null); return; }
    if (buildModeRef.current) return; // build mode: handle in onBgClick, suppress pan/deselect
    setSelectedId(null); setSelectedArrowId(null); setSelectedIds(new Set());
    const rect = containerRef.current!.getBoundingClientRect();
    const vp = viewportRef.current;
    if (tool === "lasso") {
      const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
      const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
      lassoStart.current = { cx, cy };
      lassoEnd.current   = { cx, cy };
      setLassoRect({ x1: cx, y1: cy, x2: cx, y2: cy });
    } else if (tool === "draw_arrow" || tool === "draw_ellipse") {
      const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
      const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
      drawStart.current = { cx, cy };
      setDrawCurrent({ cx, cy });
    } else if (tool === "draw_polygon") {
      // vertex added on click — handled in onBgClick
    } else {
      isPanning.current = true;
      panStart.current = { mx: e.clientX, my: e.clientY, vx: viewport.x, vy: viewport.y };
    }
  }

  function onBgClick(e: React.MouseEvent) {
    if (e.detail !== 1) return; // only single clicks
    if (buildModeRef.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      addBlock(mkShape, e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    if (tool !== "draw_polygon") return;
    const rect = containerRef.current!.getBoundingClientRect();
    const vp = viewportRef.current;
    const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
    const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
    setPolygonPts(pts => [...pts, { x: cx, y: cy }]);
  }

  function onBgDblClick(e: React.MouseEvent) {
    if (buildModeRef.current) return;
    if (tool === "draw_polygon") {
      // finish polygon on double-click (remove the duplicate point added by the two single-click events)
      setPolygonPts(pts => {
        const clean = pts.length >= 3 ? pts.slice(0, -1) : pts; // remove last dup
        if (clean.length >= 2) {
          pushUndo();
          setData(d => ({ ...d, blocks: [...d.blocks, mkDrawPolygon(clean, true)] }));
        }
        return [];
      });
      return;
    }
    if (pendingRef.current || tool === "lasso") return;
    const rect = containerRef.current!.getBoundingClientRect();
    addBlock(mkText, e.clientX - rect.left, e.clientY - rect.top);
  }

  const onHeaderPointerDown = useCallback((e: React.PointerEvent, block: CanvasBlock) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    preDragSnapshot.current = snapshotData();
    const curIds = selectedIdsRef.current;
    const inMulti = curIds.has(block.id) && curIds.size > 1;
    if (!inMulti) {
      setSelectedId(block.id);
      setSelectedIds(new Set([block.id]));
      setSelectedArrowId(null);
    }
    const others = inMulti
      ? Array.from(curIds).filter(id => id !== block.id).flatMap(id => {
          const b = dataRef.current.blocks.find(b => b.id === id);
          if (!b) return [];
          if (b.type === "divider") return [{ id, ox: b.x, oy: b.y, isDiv: true as const, ox2: b.x2, oy2: b.y2 }];
          return [{ id, ox: b.x, oy: b.y }];
        })
      : [];
    dragBlock.current = { id: block.id, mx: e.clientX, my: e.clientY, ox: block.x, oy: block.y, width: block.width, height: block.height, others };
  }, []);

  const onResizePointerDown = useCallback((e: React.PointerEvent, block: CanvasBlock) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    preResizeSnapshot.current = snapshotData();
    resizeBlock.current = { id: block.id, mx: e.clientX, my: e.clientY, ow: block.width, oh: block.height };
  }, []);

  const onPortPointerDown = useCallback((e: React.PointerEvent, blockId: string, port: Port) => {
    e.stopPropagation(); e.preventDefault();
    const pa = pendingRef.current;
    if (pa) {
      if (pa.fromId !== blockId) {
        pushUndo();
        setData(d => ({
          ...d,
          arrows: [...d.arrows, { id: uid(), fromId: pa.fromId, fromPort: pa.fromPort, toId: blockId, toPort: port }],
        }));
      }
      setPendingArrow(null); setPreviewPos(null);
    } else {
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const vp = viewportRef.current;
        setPreviewPos({ x: (e.clientX - rect.left - vp.x) / vp.zoom, y: (e.clientY - rect.top - vp.y) / vp.zoom });
      }
      setPendingArrow({ fromId: blockId, fromPort: port });
      setSelectedId(null); setSelectedIds(new Set()); setSelectedArrowId(null);
    }
  }, []);

  function onDividerPointerDown(e: React.PointerEvent, div: DividerBlock) {
    e.stopPropagation();
    preDividerSnapshot.current = snapshotData();
    setSelectedId(div.id); setSelectedIds(new Set([div.id])); setSelectedArrowId(null);
    dragDivider.current = { id: div.id, mode: "line", mx: e.clientX, my: e.clientY, ox: div.x, oy: div.y, ox2: div.x2, oy2: div.y2 };
  }

  function onDividerEndpointPointerDown(e: React.PointerEvent, div: DividerBlock, which: "p1" | "p2") {
    e.stopPropagation();
    preDividerSnapshot.current = snapshotData();
    setSelectedId(div.id); setSelectedIds(new Set([div.id])); setSelectedArrowId(null);
    dragDivider.current = { id: div.id, mode: which, mx: e.clientX, my: e.clientY, ox: div.x, oy: div.y, ox2: div.x2, oy2: div.y2 };
  }

  function onDrawArrowPointerDown(e: React.PointerEvent, b: DrawArrowBlock) {
    e.stopPropagation();
    preDrawSnapshot.current = snapshotData();
    setSelectedId(b.id); setSelectedIds(new Set([b.id])); setSelectedArrowId(null);
    dragDrawArrow.current = { id: b.id, mode: "line", mx: e.clientX, my: e.clientY, ox: b.x, oy: b.y, ox2: b.x2, oy2: b.y2 };
  }
  function onDrawArrowEndpointPointerDown(e: React.PointerEvent, b: DrawArrowBlock, which: "p1" | "p2") {
    e.stopPropagation();
    preDrawSnapshot.current = snapshotData();
    setSelectedId(b.id); setSelectedIds(new Set([b.id])); setSelectedArrowId(null);
    dragDrawArrow.current = { id: b.id, mode: which, mx: e.clientX, my: e.clientY, ox: b.x, oy: b.y, ox2: b.x2, oy2: b.y2 };
  }
  function onInkStrokePointerDown(e: React.PointerEvent, ib: InkStrokeBlock) {
    if (inkModeRef.current && e.pointerType === "pen") return;
    e.stopPropagation();
    preDrawSnapshot.current = snapshotData();
    setSelectedId(ib.id); setSelectedIds(new Set([ib.id])); setSelectedArrowId(null);
  }
  function onDrawShapePointerDown(e: React.PointerEvent, b: DrawEllipseBlock | DrawPolygonBlock) {
    e.stopPropagation();
    preDrawSnapshot.current = snapshotData();
    setSelectedId(b.id); setSelectedIds(new Set([b.id])); setSelectedArrowId(null);
    dragDrawShape.current = {
      id: b.id, mx: e.clientX, my: e.clientY, ox: b.x, oy: b.y,
      ...(b.type === "draw_polygon" ? { opts: b.points.map(p => ({ ...p })) } : {}),
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const vp = viewportRef.current;
    // ── Ink mode: accumulate pen points ──
    if (inkModeRef.current && e.pointerType === "pen" && inkActive.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
      const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
      inkActive.current.push({ x: cx, y: cy });
      setInkPreview(pointsToSmoothPath(inkActive.current));
      return;
    }
    if (pendingRef.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      setPreviewPos({ x: (e.clientX - rect.left - vp.x) / vp.zoom, y: (e.clientY - rect.top - vp.y) / vp.zoom });
    }
    if (lassoStart.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
      const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
      lassoEnd.current = { cx, cy };
      setLassoRect({ x1: lassoStart.current.cx, y1: lassoStart.current.cy, x2: cx, y2: cy });
      return;
    }
    if (isPanning.current) {
      setViewport(v => ({ ...v, x: panStart.current.vx + (e.clientX - panStart.current.mx), y: panStart.current.vy + (e.clientY - panStart.current.my) }));
    }
    if (dragBlock.current) {
      const { id, mx, my, ox, oy, width: bw, height: bh, others } = dragBlock.current;
      const dx = (e.clientX - mx) / vp.zoom;
      const dy = (e.clientY - my) / vp.zoom;
      const cx = ox + dx;
      const cy = oy + dy;

      const draggedIds = new Set([id, ...others.map(o => o.id)]);
      const { sx, sy, guides } = computeSnap(dataRef.current.blocks, draggedIds, cx, cy, bw, bh, vp.zoom);
      const snapDx = sx - cx;
      const snapDy = sy - cy;

      setSnapGuides(guides);
      setData(d => ({
        ...d,
        blocks: d.blocks.map(b => {
          if (b.id === id) return { ...b, x: sx, y: sy } as CanvasBlock;
          const oth = others.find(o => o.id === b.id);
          if (!oth) return b;
          if (oth.isDiv && b.type === "divider") {
            return { ...b, x: oth.ox + dx + snapDx, y: oth.oy + dy + snapDy, x2: oth.ox2! + dx + snapDx, y2: oth.oy2! + dy + snapDy } as CanvasBlock;
          }
          return { ...b, x: oth.ox + dx + snapDx, y: oth.oy + dy + snapDy } as CanvasBlock;
        }),
      }));
    }
    if (resizeBlock.current) {
      const { id, mx, my, ow, oh } = resizeBlock.current;
      const nw = Math.max(80, ow + (e.clientX - mx) / vp.zoom);
      const nh = Math.max(40, oh + (e.clientY - my) / vp.zoom);
      const rb = dataRef.current.blocks.find(b => b.id === id);
      if (rb && rb.type !== "divider") {
        const thr = SNAP_PX / vp.zoom;
        const re = rb.x + nw, be = rb.y + nh;
        let bestX: { diff: number; pos: number } | null = null;
        let bestY: { diff: number; pos: number } | null = null;
        for (const ob of dataRef.current.blocks) {
          if (ob.id === id || ob.type === "divider") continue;
          for (const t of [ob.x, ob.x + ob.width / 2, ob.x + ob.width]) {
            const diff = Math.abs(re - t);
            if (diff < thr && (!bestX || diff < bestX.diff)) bestX = { diff, pos: t };
          }
          for (const t of [ob.y, ob.y + ob.height / 2, ob.y + ob.height]) {
            const diff = Math.abs(be - t);
            if (diff < thr && (!bestY || diff < bestY.diff)) bestY = { diff, pos: t };
          }
        }
        const sw = bestX ? Math.max(80, bestX.pos - rb.x) : nw;
        const sh = bestY ? Math.max(40, bestY.pos - rb.y) : nh;
        setSnapGuides([
          ...(bestX ? [{ type: "v" as const, pos: bestX.pos }] : []),
          ...(bestY ? [{ type: "h" as const, pos: bestY.pos }] : []),
        ]);
        updateBlock(id, { width: sw, height: sh });
      } else {
        setSnapGuides([]);
        updateBlock(id, { width: nw, height: nh });
      }
    }
    if (dragDivider.current) {
      const { id, mode, mx, my, ox, oy, ox2, oy2 } = dragDivider.current;
      const dx = (e.clientX - mx) / vp.zoom;
      const dy = (e.clientY - my) / vp.zoom;
      setData(d => ({
        ...d,
        blocks: d.blocks.map(b => {
          if (b.id !== id || b.type !== "divider") return b;
          if (mode === "line") return { ...b, x: ox + dx, y: oy + dy, x2: ox2 + dx, y2: oy2 + dy };
          if (mode === "p1")   return { ...b, x: ox + dx, y: oy + dy };
          return                      { ...b, x2: ox2 + dx, y2: oy2 + dy };
        }),
      }));
    }
    if (dragWaypoint.current) {
      const { arrowId, waypointId, mx, my, ox, oy } = dragWaypoint.current;
      const dx = (e.clientX - mx) / vp.zoom;
      const dy = (e.clientY - my) / vp.zoom;
      setData(d => ({
        ...d,
        arrows: d.arrows.map(a => a.id !== arrowId ? a : {
          ...a,
          waypoints: (a.waypoints ?? []).map(w => w.id !== waypointId ? w : { ...w, x: ox + dx, y: oy + dy }),
        }),
      }));
    }
    // Draw preview (arrow / ellipse drag-to-create)
    if (drawStart.current && (tool === "draw_arrow" || tool === "draw_ellipse")) {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = (e.clientX - rect.left - vp.x) / vp.zoom;
      const cy = (e.clientY - rect.top  - vp.y) / vp.zoom;
      setDrawCurrent({ cx, cy });
    }
    // Drag placed draw_arrow (whole line / endpoint)
    if (dragDrawArrow.current) {
      const { id, mode, mx, my, ox, oy, ox2, oy2 } = dragDrawArrow.current;
      const dx = (e.clientX - mx) / vp.zoom;
      const dy = (e.clientY - my) / vp.zoom;
      setData(d => ({
        ...d,
        blocks: d.blocks.map(b => {
          if (b.id !== id || b.type !== "draw_arrow") return b;
          if (mode === "line") return { ...b, x: ox + dx, y: oy + dy, x2: ox2 + dx, y2: oy2 + dy };
          if (mode === "p1")   return { ...b, x: ox + dx, y: oy + dy };
          return                      { ...b, x2: ox2 + dx, y2: oy2 + dy };
        }),
      }));
    }
    // Drag placed ellipse / polygon
    if (dragDrawShape.current) {
      const { id, mx, my, ox, oy, opts } = dragDrawShape.current;
      const dx = (e.clientX - mx) / vp.zoom;
      const dy = (e.clientY - my) / vp.zoom;
      setData(d => ({
        ...d,
        blocks: d.blocks.map(b => {
          if (b.id !== id) return b;
          if (b.type === "draw_polygon" && opts) {
            return { ...b, x: ox + dx, y: oy + dy, points: opts.map(p => ({ x: p.x + dx, y: p.y + dy })) } as CanvasBlock;
          }
          return { ...b, x: ox + dx, y: oy + dy } as CanvasBlock;
        }),
      }));
    }
  }

  function onPointerUp(e?: React.PointerEvent) {
    // ── Commit ink stroke ──
    if (inkModeRef.current && e?.pointerType === "pen" && inkActive.current) {
      const pts = inkActive.current;
      if (pts.length >= 2) {
        pushUndo();
        setData(d => ({ ...d, blocks: [...d.blocks, mkInkStroke(pts, inkColor, inkWidth)] }));
      }
      inkActive.current = null;
      setInkPreview(null);
      return;
    }
    if (lassoStart.current) {
      const ls = lassoStart.current;
      const le = lassoEnd.current ?? ls;
      const lx1 = Math.min(ls.cx, le.cx), ly1 = Math.min(ls.cy, le.cy);
      const lx2 = Math.max(ls.cx, le.cx), ly2 = Math.max(ls.cy, le.cy);
      if (lx2 - lx1 > 6 || ly2 - ly1 > 6) {
        const ids = dataRef.current.blocks
          .filter(b => {
            if (b.type === "divider") {
              const bx1 = Math.min(b.x, b.x2), by1 = Math.min(b.y, b.y2);
              const bx2 = Math.max(b.x, b.x2) || bx1 + 4, by2 = Math.max(b.y, b.y2) || by1 + 4;
              return bx1 < lx2 && bx2 > lx1 && by1 < ly2 && by2 > ly1;
            }
            return b.x < lx2 && b.x + b.width > lx1 && b.y < ly2 && b.y + b.height > ly1;
          })
          .map(b => b.id);
        setSelectedIds(new Set(ids)); setSelectedId(null);
      }
      lassoStart.current = null; lassoEnd.current = null; setLassoRect(null);
    }
    // Commit pre-action snapshots only if the action actually changed something
    if (preDragSnapshot.current && dragBlock.current) {
      const drag = dragBlock.current;
      const nb = dataRef.current.blocks.find(b => b.id === drag.id);
      if (nb && (nb.x !== drag.ox || nb.y !== drag.oy)) pushUndo(preDragSnapshot.current);
    }
    if (preResizeSnapshot.current && resizeBlock.current) {
      const resize = resizeBlock.current;
      const nb = dataRef.current.blocks.find(b => b.id === resize.id);
      if (nb && (nb.width !== resize.ow || nb.height !== resize.oh)) pushUndo(preResizeSnapshot.current);
    }
    if (preDividerSnapshot.current && dragDivider.current) {
      const dd = dragDivider.current;
      const nb = dataRef.current.blocks.find(b => b.id === dd.id);
      if (nb && (nb.x !== dd.ox || nb.y !== dd.oy)) pushUndo(preDividerSnapshot.current);
    }
    if (preWaypointSnapshot.current && dragWaypoint.current) {
      const { arrowId, waypointId, ox, oy } = dragWaypoint.current;
      const arr = dataRef.current.arrows.find(a => a.id === arrowId);
      const wp = arr?.waypoints?.find(w => w.id === waypointId);
      if (wp && (wp.x !== ox || wp.y !== oy)) pushUndo(preWaypointSnapshot.current);
    }
    // Finalize draw_arrow / draw_ellipse on mouseup
    if (drawStart.current && drawCurrent && (tool === "draw_arrow" || tool === "draw_ellipse")) {
      const { cx: sx, cy: sy } = drawStart.current;
      const { cx: ex, cy: ey } = drawCurrent;
      const minDist = 8;
      if (Math.abs(ex - sx) > minDist || Math.abs(ey - sy) > minDist) {
        pushUndo();
        if (tool === "draw_arrow") {
          setData(d => ({ ...d, blocks: [...d.blocks, mkDrawArrow(sx, sy, ex, ey)] }));
        } else {
          const x = Math.min(sx, ex), y = Math.min(sy, ey);
          setData(d => ({ ...d, blocks: [...d.blocks, mkDrawEllipse(x, y, Math.abs(ex - sx), Math.abs(ey - sy))] }));
        }
      }
      drawStart.current = null; setDrawCurrent(null);
    }
    // Commit undo for draw shape drag
    if (preDrawSnapshot.current && (dragDrawArrow.current || dragDrawShape.current)) {
      const id = dragDrawArrow.current?.id ?? dragDrawShape.current?.id;
      const ox = dragDrawArrow.current?.ox ?? dragDrawShape.current?.ox;
      const oy = dragDrawArrow.current?.oy ?? dragDrawShape.current?.oy;
      const nb = dataRef.current.blocks.find(b => b.id === id);
      if (nb && (nb.x !== ox || nb.y !== oy)) pushUndo(preDrawSnapshot.current);
    }
    preDragSnapshot.current = null; preResizeSnapshot.current = null; preDividerSnapshot.current = null; preWaypointSnapshot.current = null;
    preDrawSnapshot.current = null; dragDrawArrow.current = null; dragDrawShape.current = null;
    isPanning.current = false; dragBlock.current = null; resizeBlock.current = null; dragDivider.current = null; dragWaypoint.current = null;
    setSnapGuides([]);
  }

  // ── Touch gesture handlers (pinch-to-zoom + two-finger pan) ─────────────────

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const [t0, t1] = [e.touches[0], e.touches[1]];
    touchStartRef.current = {
      dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
      midX: (t0.clientX + t1.clientX) / 2,
      midY: (t0.clientY + t1.clientY) / 2,
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2 || !touchStartRef.current) return;
    e.preventDefault();
    const [t0, t1] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const midX = (t0.clientX + t1.clientX) / 2;
    const midY = (t0.clientY + t1.clientY) / 2;
    const prev = touchStartRef.current;
    const scaleRatio = dist / prev.dist;
    const panDx = midX - prev.midX;
    const panDy = midY - prev.midY;
    if (!dragBlock.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      // Anchor point in container-local coordinates (where the fingers currently are)
      const ox = rect ? midX - rect.left : midX;
      const oy = rect ? midY - rect.top  : midY;
      setViewport(vp => {
        const newZoom = Math.min(4, Math.max(0.15, vp.zoom * scaleRatio));
        const zf = newZoom / vp.zoom;
        // Keep the canvas point under the pinch midpoint fixed, then apply pan delta
        return {
          x: ox + (vp.x - ox) * zf + panDx,
          y: oy + (vp.y - oy) * zf + panDy,
          zoom: newZoom,
        };
      });
    }
    touchStartRef.current = { dist, midX, midY };
  }

  function onTouchEnd() {
    touchStartRef.current = null;
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function closeBtn(blockId: string) {
    return (
      <button className="canvas-block-close" onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); deleteBlock(blockId); }}>×</button>
    );
  }

  function previewToggle(block: TextBlock | MathBlock) {
    return (
      <button
        className="canvas-preview-toggle"
        onPointerDown={e => e.stopPropagation()}
        onClick={() => updateBlock(block.id, { preview: !block.preview })}
      >{block.preview ? "Edit" : "Preview"}</button>
    );
  }

  function renderHeader(block: CanvasBlock) {
    if (block.type === "title") {
      const defaultSize = block.level === 1 ? 28 : block.level === 2 ? 20 : 15;
      const currentSize = block.fontSize ?? defaultSize;
      return (
        <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <div className="canvas-title-levels" onPointerDown={e => e.stopPropagation()}>
            {([1, 2, 3] as const).map(l => (
              <button key={l} className={`canvas-title-level-btn${block.level === l ? " active" : ""}`}
                onClick={() => updateBlock(block.id, { level: l, fontSize: undefined })}>H{l}</button>
            ))}
          </div>
          <div className="canvas-title-size" onPointerDown={e => e.stopPropagation()}>
            <button className="canvas-title-size-btn" onClick={() => updateBlock(block.id, { fontSize: Math.max(8, currentSize - 2) })} title="Decrease font size">A−</button>
            <span className="canvas-title-size-val">{currentSize}</span>
            <button className="canvas-title-size-btn" onClick={() => updateBlock(block.id, { fontSize: Math.min(120, currentSize + 2) })} title="Increase font size">A+</button>
          </div>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "table") {
      return (
        <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label">Table</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "math") {
      return (
        <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label">∑ Math</span>
          {previewToggle(block)}
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "sticky") {
      const preset = stickyPreset(block.color);
      return (
        <div className="canvas-block-header" style={{ background: block.color }} onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag" style={{ color: preset.accent + "60" }}>⠿</span>
          <div className="canvas-sticky-swatches" onPointerDown={e => e.stopPropagation()}>
            {STICKY_COLORS.map(p => (
              <button key={p.bg} className={`canvas-sticky-swatch${block.color === p.bg ? " active" : ""}`}
                style={{ background: p.accent }} onClick={() => updateBlock(block.id, { color: p.bg })} />
            ))}
          </div>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "checklist") {
      const done = block.items.filter(i => i.checked).length;
      return (
        <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <input className="canvas-checklist-title-input" value={block.title}
            onPointerDown={e => e.stopPropagation()} onChange={e => updateBlock(block.id, { title: e.target.value })} />
          {block.items.length > 0 && <span className="canvas-checklist-count">{done}/{block.items.length}</span>}
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "kanban") {
      return (
        <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label">Kanban</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "code_cell") {
      return (
        <div className="canvas-block-header canvas-block-header-code" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag" style={{ color: "#475569" }}>⠿</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "html") {
      return (
        <div className="canvas-block-header canvas-block-header-html" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label" style={{ color: "#ea580c" }}>HTML</span>
          <button className="canvas-preview-toggle" onPointerDown={e => e.stopPropagation()}
            onClick={() => updateBlock(block.id, { preview: !block.preview })}>
            {block.preview ? "Edit" : "Preview"}
          </button>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "image") {
      return (
        <div className="canvas-block-header canvas-block-header-image" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label">Image</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "molecule") {
      return (
        <div className="canvas-block-header canvas-block-header-chem" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label chem-header-label">⬡ Molecule</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "chem_eq") {
      return (
        <div className="canvas-block-header canvas-block-header-chem" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label chem-header-label">⇌ Equation</span>
          <button className="canvas-preview-toggle" onPointerDown={e => e.stopPropagation()}
            onClick={() => updateBlock(block.id, { preview: !block.preview })}>
            {block.preview ? "Edit" : "Preview"}
          </button>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "element") {
      return (
        <div className="canvas-block-header canvas-block-header-chem" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label chem-header-label">⚛ Element</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    if (block.type === "mol_draw") {
      return (
        <div className="canvas-block-header canvas-block-header-chem" onPointerDown={e => onHeaderPointerDown(e, block)}>
          <span className="canvas-block-drag">⠿</span>
          <span className="canvas-block-type-label chem-header-label">✏ Draw</span>
          {closeBtn(block.id)}
        </div>
      );
    }
    // text (default)
    return (
      <div className="canvas-block-header" onPointerDown={e => onHeaderPointerDown(e, block)}>
        <span className="canvas-block-drag">⠿</span>
        {previewToggle(block as TextBlock)}
        {closeBtn(block.id)}
      </div>
    );
  }

  async function runAllCells() {
    const blocks = dataRef.current.blocks;
    const arrows = dataRef.current.arrows;
    const order = getExecutionOrder(blocks, arrows);
    for (const id of order) {
      const block = blocks.find(b => b.id === id) as CodeCellBlock | undefined;
      if (!block) continue;
      const sessionId = getComponentSessionId(id, nodeId, blocks, arrows);
      const lang = block.language ?? "python";
      updateBlock(id, { running: true, outputs: [] });
      try {
        let outputs: OutputChunk[];
        if (lang === "sql") {
          outputs = await runSqlCode(sessionId, block.code);
        } else {
          const result = await invoke<{ chunks: { type: string; content: string }[] }>(
            "run_python", { sessionId, code: block.code }
          );
          outputs = result.chunks as OutputChunk[];
        }
        updateBlock(id, { running: false, outputs });
      } catch (e) {
        updateBlock(id, { running: false, outputs: [{ type: "error", content: String(e) }] });
      }
    }
  }

  async function restartKernel() {
    const blocks = dataRef.current.blocks;
    const arrows = dataRef.current.arrows;
    const cellIds = blocks.filter(b => b.type === "code_cell").map(b => b.id);

    const pythonSessionIds = new Set(
      cellIds
        .filter(id => ((blocks.find(b => b.id === id) as CodeCellBlock)?.language ?? "python") === "python")
        .map(id => getComponentSessionId(id, nodeId, blocks, arrows))
    );
    const sqlSessionIds = new Set(
      cellIds
        .filter(id => (blocks.find(b => b.id === id) as CodeCellBlock)?.language === "sql")
        .map(id => getComponentSessionId(id, nodeId, blocks, arrows))
    );

    await Promise.all([...pythonSessionIds].map(sid => invoke("reset_python_session", { sessionId: sid })));
    sqlSessionIds.forEach(sid => _resetSqlSession(sid));

    setData(d => ({
      ...d,
      blocks: d.blocks.map(b => b.type === "code_cell"
        ? { ...b, outputs: [], running: false }
        : b),
    }));
  }

  function renderContent(block: CanvasBlock) {
    if (block.type === "title") {
      const cls = `canvas-title-input canvas-title-h${block.level}`;
      return (
        <input className={cls} value={block.text} placeholder={`Heading ${block.level}…`}
          style={block.fontSize !== undefined ? { fontSize: block.fontSize } : undefined}
          onChange={e => updateBlock(block.id, { text: e.target.value })}
          onPointerDown={e => e.stopPropagation()} />
      );
    }
    if (block.type === "table") {
      return <TableContent block={block} onUpdate={updateBlock} zoom={viewport.zoom} onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />;
    }
    if (block.type === "math") {
      return <MathContent block={block} onUpdate={updateBlock} />;
    }
    if (block.type === "text") {
      if (block.preview) {
        return (
          <div className="canvas-block-md-preview" onPointerDown={e => e.stopPropagation()}>
            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</Markdown>
          </div>
        );
      }
      return (
        <textarea className="canvas-block-text" value={block.content} placeholder="Markdown supported…"
          onChange={e => updateBlock(block.id, { content: e.target.value })}
          onPaste={handleNativePaste}
          onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} />
      );
    }
    if (block.type === "sticky") {
      const { accent } = stickyPreset(block.color);
      return (
        <textarea className="canvas-block-text" value={block.content} placeholder="Type here…"
          style={{ color: accent }}
          onChange={e => updateBlock(block.id, { content: e.target.value })}
          onPaste={handleNativePaste}
          onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} />
      );
    }
    if (block.type === "checklist") return <ChecklistContent block={block} onUpdate={updateBlock} />;
    if (block.type === "kanban")    return <KanbanContent    block={block} onUpdate={updateBlock} onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />;
    if (block.type === "html") return (
      <HtmlContent block={block} onUpdate={updateBlock}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />
    );
    if (block.type === "code_cell") return (
      <CodeCellContent
        block={block}
        sessionId={getComponentSessionId(block.id, nodeId, data.blocks, data.arrows)}
        onUpdate={patch => updateBlock(block.id, patch as Patch)}
        onRunAll={runAllCells}
        onRestart={restartKernel}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }}
      />
    );
    if (block.type === "image") return (
      <img
        className="canvas-image-content"
        src={block.src}
        alt=""
        draggable={false}
        onPointerDown={e => e.stopPropagation()}
      />
    );
    if (block.type === "molecule") return (
      <MoleculeContent block={block} onUpdate={updateBlock}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />
    );
    if (block.type === "chem_eq") return (
      <ChemEqContent block={block} onUpdate={updateBlock}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />
    );
    if (block.type === "element") return (
      <ElementContent block={block} onUpdate={updateBlock}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />
    );
    if (block.type === "mol_draw") return (
      <MolDrawContent block={block} onUpdate={updateBlock}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }} />
    );
    if (block.type === "matrix") return (
      <MatrixBlockContent
        block={block}
        onPatch={p => updateBlock(block.id, p as Patch)}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }}
      />
    );
    if (block.type === "simple_grid") return (
      <GridBlockContent
        block={block}
        onPatch={p => updateBlock(block.id, p as Patch)}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }}
      />
    );
    if (block.type === "graph_theory") return (
      <GraphBlockContent
        block={block}
        onPatch={p => updateBlock(block.id, p as Patch)}
        onSelect={() => { setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null); }}
      />
    );
  }

  // ── Canvas navigation ────────────────────────────────────────────────────────

  function navigateTo(block: CanvasBlock) {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const bx = block.type === "divider" ? (block.x + block.x2) / 2 : block.x + block.width / 2;
    const by = block.type === "divider" ? (block.y + block.y2) / 2 : block.y + block.height / 2;
    setViewport(vp => ({ ...vp, x: cw / 2 - bx * vp.zoom, y: ch / 2 - by * vp.zoom }));
  }

  // ── Derived display state ────────────────────────────────────────────────────

  const showPortsFor = useMemo(() => {
    const s = new Set<string>();
    if (pendingArrow) {
      data.blocks.forEach(b => { if (b.type !== "divider" && b.type !== "frame") s.add(b.id); });
    } else {
      if (hoveredBlockId) { const hb = data.blocks.find(b => b.id === hoveredBlockId); if (hb && hb.type !== "divider" && hb.type !== "frame") s.add(hoveredBlockId); }
      if (selectedId)     { const sb = data.blocks.find(b => b.id === selectedId);     if (sb && sb.type !== "divider" && sb.type !== "frame") s.add(selectedId); }
    }
    return s;
  }, [pendingArrow, hoveredBlockId, selectedId, data.blocks]);

  // ── Memoized filtered block lists (avoids re-filtering on every render) ──────
  const dividerBlocks     = useMemo(() => data.blocks.filter((b): b is DividerBlock     => b.type === "divider"),     [data.blocks]);
  const drawArrowBlocks   = useMemo(() => data.blocks.filter((b): b is DrawArrowBlock   => b.type === "draw_arrow"),  [data.blocks]);
  const drawEllipseBlocks = useMemo(() => data.blocks.filter((b): b is DrawEllipseBlock => b.type === "draw_ellipse"), [data.blocks]);
  const drawPolygonBlocks = useMemo(() => data.blocks.filter((b): b is DrawPolygonBlock => b.type === "draw_polygon"), [data.blocks]);
  const inkStrokeBlocks   = useMemo(() => data.blocks.filter((b): b is InkStrokeBlock   => b.type === "ink_stroke"),   [data.blocks]);

  // ── Memoized arrow JSX — avoids bezier recompute on snap-guide / hover changes ─
  const arrowElements = useMemo(() => data.arrows.map(arrow => {
    const fb = data.blocks.find(b => b.id === arrow.fromId);
    const tb = data.blocks.find(b => b.id === arrow.toId);
    if (!fb || !tb) return null;
    const p1 = getPortPos(fb as any, arrow.fromPort);
    const p2 = getPortPos(tb as any, arrow.toPort);
    const wpts = arrow.waypoints ?? [];
    const pathD = makePathWithWaypoints(p1, arrow.fromPort, p2, arrow.toPort, wpts);
    const sel = selectedArrowId === arrow.id;
    return (
      <g key={arrow.id}>
        <path d={pathD} fill="none" stroke="transparent" strokeWidth={12} pointerEvents="stroke"
          style={{ cursor: sel ? "crosshair" : "pointer" }}
          onPointerDown={e => e.stopPropagation()}
          onPointerMove={sel ? e => {
            const rect = containerRef.current!.getBoundingClientRect();
            const vp = viewportRef.current;
            setArrowHoverPos({ arrowId: arrow.id, x: (e.clientX - rect.left - vp.x) / vp.zoom, y: (e.clientY - rect.top - vp.y) / vp.zoom });
          } : undefined}
          onPointerLeave={sel ? () => setArrowHoverPos(null) : undefined}
          onClick={e => {
            e.stopPropagation();
            if (selectedArrRef.current === arrow.id) {
              const rect = containerRef.current!.getBoundingClientRect();
              const vp = viewportRef.current;
              const wx = (e.clientX - rect.left - vp.x) / vp.zoom;
              const wy = (e.clientY - rect.top  - vp.y) / vp.zoom;
              const pts = [p1, ...wpts, p2];
              const idx = waypointInsertIndex(pts, { x: wx, y: wy });
              const newWp = { id: uid(), x: wx, y: wy };
              pushUndo();
              setArrowHoverPos(null);
              setData(d => ({ ...d, arrows: d.arrows.map(a => a.id === arrow.id ? { ...a, waypoints: [...wpts.slice(0, idx), newWp, ...wpts.slice(idx)] } : a) }));
            } else {
              setSelectedId(null); setSelectedIds(new Set()); setSelectedArrowId(arrow.id);
            }
          }} />
        <path d={pathD} fill="none" stroke={sel ? "var(--border-strong)" : "var(--fg-ghost)"}
          strokeWidth={sel ? 2 : 1.5} strokeLinecap="round" markerEnd={sel ? "url(#ah-sel)" : "url(#ah)"} pointerEvents="none" />
        {sel && arrowHoverPos?.arrowId === arrow.id && (
          <circle cx={arrowHoverPos.x} cy={arrowHoverPos.y} r={5}
            fill="rgba(99,102,241,0.25)" stroke="#6366f1" strokeWidth={1.5}
            pointerEvents="none" />
        )}
        {sel && wpts.map(wp => (
          <circle key={wp.id} cx={wp.x} cy={wp.y} r={5}
            fill="var(--bg-base)" stroke="var(--border-strong)" strokeWidth={1.5}
            style={{ cursor: "grab" }}
            onPointerDown={e => {
              e.stopPropagation();
              preWaypointSnapshot.current = snapshotData();
              dragWaypoint.current = { arrowId: arrow.id, waypointId: wp.id, mx: e.clientX, my: e.clientY, ox: wp.x, oy: wp.y };
            }}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => {
              e.stopPropagation();
              pushUndo();
              setData(d => ({ ...d, arrows: d.arrows.map(a => a.id === arrow.id ? { ...a, waypoints: (a.waypoints ?? []).filter(w => w.id !== wp.id) } : a) }));
            }} />
        ))}
      </g>
    );
  }), [data.arrows, data.blocks, selectedArrowId, arrowHoverPos]);

  // ── Memoized block JSX — viewport.x/y excluded so panning skips reconciliation ─
  const blockElements = useMemo(() => data.blocks.map(block => {
    if (block.type === "divider" || block.type === "draw_arrow" || block.type === "draw_ellipse" || block.type === "draw_polygon") return null;
    const selected   = selectedId === block.id || (selectedIds.has(block.id) && selectedIds.size === 1);
    const inMultiSel = selectedIds.has(block.id) && selectedIds.size > 1;

    if (block.type === "frame") {
      const fColor  = block.color       ?? "#94a3b8";
      const fStyle  = block.borderStyle ?? "dashed";
      const fWidth  = block.borderWidth ?? 2;
      const fRadius = block.radius      ?? 10;
      const fFill   = block.fill        ?? "transparent";
      return (
        <div key={block.id}
          className={`canvas-frame${selected ? " selected" : ""}${inMultiSel ? " multi-selected" : ""}`}
          style={{
            left: block.x, top: block.y, width: block.width, height: block.height, zIndex: 0,
            borderColor: fColor, borderStyle: fStyle, borderWidth: fWidth,
            borderRadius: fRadius, background: fFill,
          }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setSelectedId(block.id); setSelectedIds(new Set([block.id])); setContextMenu({ x: e.clientX, y: e.clientY, blockId: block.id }); }}
        >
          <div className="canvas-frame-tag" style={{ borderColor: fColor, color: fColor }}
            onPointerDown={e => onHeaderPointerDown(e, block)}>
            <span className="canvas-frame-drag">⠿</span>
            <input
              className="canvas-frame-label-input"
              value={block.label}
              placeholder="Group…"
              onChange={e => updateBlock(block.id, { label: e.target.value })}
              onPointerDown={e => e.stopPropagation()}
            />
            {(selected || inMultiSel) && (
              <button className="canvas-block-close" onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); deleteBlock(block.id); }}>×</button>
            )}
          </div>
          {(selected || inMultiSel) && (
            <div className="canvas-frame-toolbar" onPointerDown={e => e.stopPropagation()}>
              {FRAME_COLORS.map(c => (
                <button key={c} className={`canvas-frame-color-btn${fColor === c ? " active" : ""}`}
                  style={{ background: c, outlineColor: c }}
                  onClick={() => updateBlock(block.id, { color: c })} />
              ))}
              <div className="canvas-frame-tb-sep" />
              {(["solid","dashed","dotted"] as const).map(s => (
                <button key={s} className={`canvas-frame-tb-btn${fStyle === s ? " active" : ""}`}
                  title={s} onClick={() => updateBlock(block.id, { borderStyle: s })}>
                  {s === "solid" ? "—" : s === "dashed" ? "╌╌" : "⋯"}
                </button>
              ))}
              <div className="canvas-frame-tb-sep" />
              {([1.5, 2.5, 4] as const).map(w => (
                <button key={w} className={`canvas-frame-tb-btn${fWidth === w ? " active" : ""}`}
                  title={`${w}px border`} onClick={() => updateBlock(block.id, { borderWidth: w })}>
                  <span style={{ display:"block", height: w < 2 ? "1px" : w < 3 ? "2px" : "4px", width: 14, background:"currentColor", borderRadius: 1 }} />
                </button>
              ))}
              <div className="canvas-frame-tb-sep" />
              {([0, 10, 24] as const).map(r => (
                <button key={r} className={`canvas-frame-tb-btn${fRadius === r ? " active" : ""}`}
                  title={`Radius ${r}`} onClick={() => updateBlock(block.id, { radius: r })}>
                  <span style={{ display:"block", width:13, height:13, border:"1.5px solid currentColor", borderRadius: r === 0 ? 1 : r === 10 ? 4 : 9, background:"transparent" }} />
                </button>
              ))}
              <div className="canvas-frame-tb-sep" />
              {FRAME_FILLS.map((f, i) => (
                <button key={i} className={`canvas-frame-color-btn${fFill === f ? " active" : ""}`}
                  style={{
                    background: i === 0 ? "var(--bg-base)" : f,
                    outlineColor: fColor,
                    ...(i === 0 ? { border: "1px dashed var(--border-base)" } : {}),
                  }}
                  title={i === 0 ? "No fill" : "Tinted fill"}
                  onClick={() => updateBlock(block.id, { fill: f })} />
              ))}
            </div>
          )}
          <div className="canvas-block-resize" onPointerDown={e => onResizePointerDown(e, block)} />
        </div>
      );
    }

    const isShape   = block.type === "shape";
    const showPorts = showPortsFor.has(block.id);

    if (isShape) {
      return (
        <div key={block.id}
          className={`canvas-block canvas-block-shape${selected ? " selected" : ""}${inMultiSel ? " multi-selected" : ""}`}
          style={{ left: block.x, top: block.y, width: block.width, height: block.height, zIndex: 2 }}
          onPointerDown={e => {
            if (inkModeRef.current && e.pointerType === "pen") return;
            e.stopPropagation();
            if (buildModeRef.current) {
              if (e.shiftKey) {
                const fromId = selectedIdRef.current;
                if (fromId && fromId !== block.id) {
                  pushUndo();
                  setData(d => ({ ...d, arrows: [...d.arrows, { id: uid(), fromId, fromPort: "right", toId: block.id, toPort: "left" }] }));
                }
                return; // keep current active node
              }
              setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null);
              return;
            }
            const curIds = selectedIdsRef.current;
            if (curIds.has(block.id) && curIds.size > 1) return;
            setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null);
          }}
          onMouseEnter={() => setHoveredBlockId(block.id)}
          onMouseLeave={() => setHoveredBlockId(null)}
          onDoubleClick={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setSelectedId(block.id); setSelectedIds(new Set([block.id])); setContextMenu({ x: e.clientX, y: e.clientY, blockId: block.id }); }}
        >
          <svg viewBox={`0 0 ${block.width} ${block.height}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <ShapeSvg shape={block.shape} width={block.width} height={block.height} selected={selected || inMultiSel} color={block.color} />
          </svg>
          <textarea className="canvas-shape-label" value={block.label} placeholder="Label…"
            style={{ color: block.color === "#1e293b" ? "rgba(255,255,255,0.88)" : undefined }}
            onChange={e => updateBlock(block.id, { label: e.target.value })}
            onPaste={handleNativePaste}
            onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} />
          {(showPorts || selected || inMultiSel) && (
            <div className="canvas-shape-toolbar" onPointerDown={e => e.stopPropagation()}>
              {(Object.keys(SHAPE_ICONS) as ShapeKind[]).map(sk => (
                <button key={sk} className={`canvas-shape-type-btn${block.shape === sk ? " active" : ""}`}
                  title={sk} onClick={() => updateBlock(block.id, { shape: sk })}>{SHAPE_ICONS[sk]}</button>
              ))}
              <div className="canvas-shape-toolbar-sep" />
              {SHAPE_COLORS.map(c => (
                <button key={c} className={`canvas-shape-color-btn${(block.color ?? "#ffffff") === c ? " active" : ""}`}
                  style={{ background: c }} title={c}
                  onClick={() => updateBlock(block.id, { color: c })} />
              ))}
              <div className="canvas-shape-toolbar-sep" />
              <button className="canvas-block-close" onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); deleteBlock(block.id); }}>×</button>
            </div>
          )}
          <div className="canvas-shape-drag" onPointerDown={e => onHeaderPointerDown(e, block)}>⠿</div>
          <div className="canvas-block-resize" onPointerDown={e => onResizePointerDown(e, block)} />
          {showPorts && PORTS.map(port => (
            <div key={port} className="canvas-port" style={portDotStyle(port)}
              onPointerDown={e => onPortPointerDown(e, block.id, port)} />
          ))}
        </div>
      );
    }

    // Standard block
    return (
      <div key={block.id}
        className={`canvas-block canvas-block-${block.type}${selected ? " selected" : ""}${inMultiSel ? " multi-selected" : ""}`}
        style={{
          left: block.x, top: block.y, width: block.width, height: block.height, zIndex: 2,
          ...(block.type === "sticky" ? { background: block.color, borderColor: stickyPreset(block.color).accent + "50" } : {}),
        }}
        onPointerDown={e => {
          if (inkModeRef.current && e.pointerType === "pen") return;
          e.stopPropagation();
          if (buildModeRef.current) {
            if (e.shiftKey) {
              const fromId = selectedIdRef.current;
              if (fromId && fromId !== block.id) {
                pushUndo();
                setData(d => ({ ...d, arrows: [...d.arrows, { id: uid(), fromId, fromPort: "right", toId: block.id, toPort: "left" }] }));
              }
              return;
            }
            setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null);
            return;
          }
          const curIds = selectedIdsRef.current;
          if (curIds.has(block.id) && curIds.size > 1) return;
          setSelectedId(block.id); setSelectedIds(new Set([block.id])); setSelectedArrowId(null);
        }}
        onMouseEnter={() => setHoveredBlockId(block.id)}
        onMouseLeave={() => setHoveredBlockId(null)}
        onDoubleClick={e => e.stopPropagation()}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setSelectedId(block.id); setSelectedIds(new Set([block.id])); setContextMenu({ x: e.clientX, y: e.clientY, blockId: block.id }); }}
      >
        {renderHeader(block)}
        {renderContent(block)}
        <div className="canvas-block-resize" onPointerDown={e => onResizePointerDown(e, block)} />
        {showPorts && PORTS.map(port => (
          <div key={port} className="canvas-port" style={portDotStyle(port)}
            onPointerDown={e => onPortPointerDown(e, block.id, port)} />
        ))}
      </div>
    );
  }), [data.blocks, data.arrows, selectedId, selectedIds, showPortsFor, viewport.zoom, nodeId,
       updateBlock, deleteBlock, onHeaderPointerDown, onResizePointerDown, onPortPointerDown]);

  const multiCount = selectedIds.size;
  const { x, y, zoom } = viewport;
  const gridSize = 28 * zoom;

  return (
    <div
      ref={containerRef}
      className={`canvas-editor${pendingArrow ? " canvas-connecting" : ""}${tool === "lasso" ? " canvas-lasso-mode" : ""}${tool.startsWith("draw_") ? " canvas-draw-mode" : ""}${buildMode ? " canvas-build-mode" : ""}${inkMode ? " canvas-ink-mode" : ""}`}
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${x % gridSize}px ${y % gridSize}px` }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onBgClick}
      onDoubleClick={onBgDblClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* ── Toolbar trigger strip (indicator shown when toolbar is hidden) ── */}
      <div
        className={`canvas-toolbar-trigger${showToolbar ? "" : " show-indicator"}`}
        onMouseEnter={() => { if (toolbarHideTimer.current) clearTimeout(toolbarHideTimer.current); setShowToolbar(true); }}
      />

      {/* ── Toolbar ── */}
      <div
        className={`canvas-overlay-toolbar${showToolbar ? " visible" : ""}`}
        onMouseEnter={() => { if (toolbarHideTimer.current) clearTimeout(toolbarHideTimer.current); setShowToolbar(true); }}
        onMouseLeave={() => { toolbarHideTimer.current = setTimeout(() => { setShowToolbar(false); setOpenMenu(null); }, 600); }}
        onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      >
        {/* Select toggle */}
        <button
          className={`canvas-tool-btn canvas-tool-lasso${tool === "lasso" ? " canvas-tool-active" : ""}`}
          title="Select / Lasso (drag to multi-select)"
          onClick={() => setTool(t => t === "lasso" ? "pan" : "lasso")}
        >Select</button>

        {/* Build mode toggle */}
        <button
          className={`canvas-tool-btn${buildMode ? " canvas-tool-active" : ""}`}
          title="Build Mode — click canvas to create shapes; click node to make active; Shift+click node to connect from active"
          onClick={() => { setBuildMode(m => !m); setTool("pan"); setOpenMenu(null); setInkMode(false); inkActive.current = null; setInkPreview(null); }}
        >⊕ Build</button>

        {/* Ink / Draw mode toggle */}
        <button
          className={`canvas-tool-btn${inkMode ? " canvas-tool-active" : ""}`}
          title="Ink Mode — Apple Pencil draws freely anywhere; single-finger touch suppressed; two-finger pan/zoom still works"
          onClick={() => {
            const next = !inkMode;
            setInkMode(next);
            if (next) {
              setBuildMode(false);
              setTool("pan");
              setPolygonPts([]);
              drawStart.current = null; setDrawCurrent(null);
              setOpenMenu(null);
            }
            inkActive.current = null;
            setInkPreview(null);
          }}
        >✏ Ink</button>
        <div className="canvas-toolbar-sep" />

        {/* Text group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${openMenu === "text" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "text" ? null : "text")}
          >Text <span className="tbg-arrow">{openMenu === "text" ? "▴" : "▾"}</span></button>
          {openMenu === "text" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkTitle)}>Title</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkText)}>Text</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkSticky)}>Sticky</button>
            </div>
          )}
        </div>

        {/* Layout group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${openMenu === "layout" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "layout" ? null : "layout")}
          >Layout <span className="tbg-arrow">{openMenu === "layout" ? "▴" : "▾"}</span></button>
          {openMenu === "layout" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkShape)}>Shape</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkFrame)}>⬚ Frame</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkDivider)}>Divider</button>
            </div>
          )}
        </div>

        {/* Draw group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${tool.startsWith("draw_") ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "draw" ? null : "draw")}
          >Draw <span className="tbg-arrow">{openMenu === "draw" ? "▴" : "▾"}</span></button>
          {openMenu === "draw" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button
                className={`toolbar-dd-item${tool === "draw_arrow" ? " toolbar-dd-active" : ""}`}
                onClick={() => setTool(t => t === "draw_arrow" ? "pan" : "draw_arrow")}
              >↗ Arrow / Line</button>
              <button
                className={`toolbar-dd-item${tool === "draw_ellipse" ? " toolbar-dd-active" : ""}`}
                onClick={() => setTool(t => t === "draw_ellipse" ? "pan" : "draw_ellipse")}
              >○ Circle / Ellipse</button>
              <button
                className={`toolbar-dd-item${tool === "draw_polygon" ? " toolbar-dd-active" : ""}`}
                onClick={() => { setTool(t => t === "draw_polygon" ? "pan" : "draw_polygon"); setPolygonPts([]); }}
              >⬡ Polygon / Path</button>
            </div>
          )}
        </div>

        {/* Data group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${openMenu === "data" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "data" ? null : "data")}
          >Data <span className="tbg-arrow">{openMenu === "data" ? "▴" : "▾"}</span></button>
          {openMenu === "data" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkTable)}>Table</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkChecklist)}>Checklist</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkKanban)}>Kanban</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkMath)}>∑ Math</button>
            </div>
          )}
        </div>

        {/* Math group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${openMenu === "math" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "math" ? null : "math")}
          >Math <span className="tbg-arrow">{openMenu === "math" ? "▴" : "▾"}</span></button>
          {openMenu === "math" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkMath)}>∑ Formula</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkSimpleGrid)}>▦ Grid</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkMatrix)}>⊞ Matrix (Gauss)</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkGraphTheory)}>⬡ Graph</button>
            </div>
          )}
        </div>

        {/* Code group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn${openMenu === "code" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "code" ? null : "code")}
          >Code <span className="tbg-arrow">{openMenu === "code" ? "▴" : "▾"}</span></button>
          {openMenu === "code" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkCodeCell)}>{"{ }"} Code cell</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkHtml)}>{"</>"} HTML</button>
              <button className="toolbar-dd-item" onClick={() => imageInputRef.current?.click()}>🖼 Image file</button>
            </div>
          )}
        </div>

        {/* Chem group */}
        <div className="toolbar-group">
          <button
            className={`canvas-tool-btn toolbar-group-btn canvas-tool-chem${openMenu === "chem" ? " canvas-tool-active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "chem" ? null : "chem")}
          >Chem <span className="tbg-arrow">{openMenu === "chem" ? "▴" : "▾"}</span></button>
          {openMenu === "chem" && (
            <div className="toolbar-dropdown" onClick={() => setOpenMenu(null)}>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkMolDraw)}>✏ Draw molecule</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkMolecule)}>⬡ SMILES</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkChemEq)}>⇌ Equation</button>
              <button className="toolbar-dd-item" onClick={() => addBlock(mkElement)}>⚛ Element</button>
            </div>
          )}
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const src = reader.result as string;
              const img = new Image();
              img.onload = () => {
                const maxW = 600, maxH = 480;
                const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
                const w = Math.round(img.naturalWidth * scale);
                const h = Math.round(img.naturalHeight * scale);
                addBlock((x, y) => mkImage(x, y, src, w, h));
              };
              img.src = src;
            };
            reader.readAsDataURL(file);
            e.target.value = "";
          }}
        />

        {/* Contextual: pending arrow hint / selection delete */}
        {pendingArrow && <><div className="canvas-toolbar-sep" /><span className="canvas-connect-hint">click a port to connect · esc to cancel</span></>}
        {!pendingArrow && multiCount > 1 && (
          <><div className="canvas-toolbar-sep" /><button className="canvas-tool-btn canvas-tool-delete" onClick={() => {
            pushUndo();
            setData(d => ({
              ...d,
              blocks: d.blocks.filter(b => !selectedIds.has(b.id)),
              arrows: d.arrows.filter(a => !selectedIds.has(a.fromId) && !selectedIds.has(a.toId)),
            }));
            setSelectedIds(new Set()); setSelectedId(null);
          }}>Delete {multiCount}</button></>
        )}
        {!pendingArrow && multiCount <= 1 && (selectedId || selectedArrowId) && (
          <><div className="canvas-toolbar-sep" /><button className="canvas-tool-btn canvas-tool-delete" onClick={() => {
            if (selectedArrowId) {
              pushUndo();
              setData(d => ({ ...d, arrows: d.arrows.filter(a => a.id !== selectedArrowId) }));
              setSelectedArrowId(null);
            } else if (selectedId) {
              deleteBlock(selectedId);
            }
          }}>Delete</button></>
        )}
        <div className="canvas-toolbar-sep" />
        <span className="canvas-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>

      {/* ── Canvas world ── */}
      <div className="canvas-world" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        {/* Arrow + Divider SVG layer */}
        <svg width={1} height={1} style={{ position: "absolute", top: 0, left: 0, overflow: "visible", zIndex: 1 }}>
          <defs>
            <marker id="ah"     markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--fg-ghost)" />
            </marker>
            <marker id="ah-sel" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--border-strong)" />
            </marker>
          </defs>
          {arrowElements}
          {pendingArrow && previewPos && (() => {
            const fb = data.blocks.find(b => b.id === pendingArrow.fromId);
            if (!fb) return null;
            const p1 = getPortPos(fb as any, pendingArrow.fromPort);
            return (
              <line x1={p1.x} y1={p1.y} x2={previewPos.x} y2={previewPos.y}
                stroke="var(--fg-muted)" strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" pointerEvents="none" />
            );
          })()}
          {/* ── Draw arrows ───────────────────────────────────────────── */}
          {drawArrowBlocks.map(da => {
            const sel = selectedId === da.id || selectedIds.has(da.id);
            const da2 = da.dashed ? "8 5" : undefined;
            const markId = `da-${da.id}`;
            const markIdS = `da-s-${da.id}`;
            return (
              <g key={da.id}>
                <defs>
                  {da.headEnd && <marker id={markId} markerWidth="7" markerHeight="6" refX="6.5" refY="3" orient="auto">
                    <polygon points="0 0, 7 3, 0 6" fill={da.color} />
                  </marker>}
                  {da.headStart && <marker id={markIdS} markerWidth="7" markerHeight="6" refX="0.5" refY="3" orient="auto-start-reverse">
                    <polygon points="0 0, 7 3, 0 6" fill={da.color} />
                  </marker>}
                </defs>
                {/* Invisible wide hit area */}
                <line x1={da.x} y1={da.y} x2={da.x2} y2={da.y2}
                  stroke="transparent" strokeWidth={14} pointerEvents="stroke" style={{ cursor: "move" }}
                  onPointerDown={e => onDrawArrowPointerDown(e, da)} />
                {/* Visible line */}
                <line x1={da.x} y1={da.y} x2={da.x2} y2={da.y2}
                  stroke={da.color} strokeWidth={sel ? da.strokeWidth + 1 : da.strokeWidth}
                  strokeDasharray={da2} strokeLinecap="round" pointerEvents="none"
                  markerEnd={da.headEnd ? `url(#${markId})` : undefined}
                  markerStart={da.headStart ? `url(#${markIdS})` : undefined} />
                {sel && (
                  <>
                    <circle cx={da.x} cy={da.y} r={5}
                      fill="var(--bg-base)" stroke={da.color} strokeWidth={1.5}
                      style={{ cursor: "grab" }} pointerEvents="all"
                      onPointerDown={e => onDrawArrowEndpointPointerDown(e, da, "p1")} />
                    <circle cx={da.x2} cy={da.y2} r={5}
                      fill="var(--bg-base)" stroke={da.color} strokeWidth={1.5}
                      style={{ cursor: "grab" }} pointerEvents="all"
                      onPointerDown={e => onDrawArrowEndpointPointerDown(e, da, "p2")} />
                  </>
                )}
              </g>
            );
          })}

          {/* ── Draw ellipses ─────────────────────────────────────────── */}
          {drawEllipseBlocks.map(de => {
            const sel = selectedId === de.id || selectedIds.has(de.id);
            const da = de.dashed ? "8 5" : undefined;
            const cx = de.x + de.width / 2, cy = de.y + de.height / 2;
            const rx = de.width / 2, ry = de.height / 2;
            return (
              <g key={de.id}>
                <ellipse cx={cx} cy={cy} rx={Math.max(rx, 5)} ry={Math.max(ry, 5)}
                  fill="transparent" stroke="transparent" strokeWidth={14}
                  pointerEvents="stroke" style={{ cursor: "move" }}
                  onPointerDown={e => onDrawShapePointerDown(e, de)} />
                <ellipse cx={cx} cy={cy} rx={Math.max(rx, 5)} ry={Math.max(ry, 5)}
                  fill={de.fill} stroke={de.color}
                  strokeWidth={sel ? de.strokeWidth + 1 : de.strokeWidth}
                  strokeDasharray={da} pointerEvents="none"
                  strokeDashoffset="0" />
                {sel && (
                  <rect x={de.x - 4} y={de.y - 4} width={de.width + 8} height={de.height + 8}
                    fill="none" stroke="var(--border-strong)" strokeWidth={1}
                    strokeDasharray="4 3" rx={2} pointerEvents="none" />
                )}
              </g>
            );
          })}

          {/* ── Draw polygons ─────────────────────────────────────────── */}
          {drawPolygonBlocks.map(dp => {
            const sel = selectedId === dp.id || selectedIds.has(dp.id);
            const da = dp.dashed ? "8 5" : undefined;
            const pts = dp.points;
            if (pts.length < 2) return null;
            const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + (dp.closed ? " Z" : "");
            const bx1 = Math.min(...pts.map(p => p.x)), by1 = Math.min(...pts.map(p => p.y));
            const bx2 = Math.max(...pts.map(p => p.x)), by2 = Math.max(...pts.map(p => p.y));
            return (
              <g key={dp.id}>
                <path d={d} fill="transparent" stroke="transparent" strokeWidth={14}
                  pointerEvents="stroke" style={{ cursor: "move" }}
                  onPointerDown={e => onDrawShapePointerDown(e, dp)} />
                <path d={d} fill={dp.fill} stroke={dp.color}
                  strokeWidth={sel ? dp.strokeWidth + 1 : dp.strokeWidth}
                  strokeDasharray={da} strokeLinecap="round" strokeLinejoin="round"
                  pointerEvents="none" />
                {sel && (
                  <rect x={bx1 - 4} y={by1 - 4} width={bx2 - bx1 + 8} height={by2 - by1 + 8}
                    fill="none" stroke="var(--border-strong)" strokeWidth={1}
                    strokeDasharray="4 3" rx={2} pointerEvents="none" />
                )}
              </g>
            );
          })}

          {/* ── Ink strokes ──────────────────────────────────────────── */}
          {inkStrokeBlocks.map(ib => {
            const sel = selectedId === ib.id || selectedIds.has(ib.id);
            const d = pointsToSmoothPath(ib.points);
            if (!d) return null;
            return (
              <g key={ib.id}>
                <path d={d} fill="none" stroke="transparent"
                  strokeWidth={Math.max(ib.strokeWidth + 8, 12)}
                  pointerEvents="stroke" style={{ cursor: "default" }}
                  onPointerDown={e => onInkStrokePointerDown(e, ib)} />
                <path d={d} fill="none" stroke={ib.color}
                  strokeWidth={sel ? ib.strokeWidth + 1 : ib.strokeWidth}
                  strokeLinecap="round" strokeLinejoin="round"
                  pointerEvents="none" />
                {sel && (
                  <rect x={ib.x - 4} y={ib.y - 4}
                    width={ib.width + 8} height={ib.height + 8}
                    fill="none" stroke="var(--border-strong)"
                    strokeWidth={1} strokeDasharray="4 3" rx={2}
                    pointerEvents="none" />
                )}
              </g>
            );
          })}

          {/* ── Ink live preview ─────────────────────────────────────── */}
          {inkPreview && (
            <path d={inkPreview} fill="none"
              stroke={inkColor} strokeWidth={inkWidth}
              strokeLinecap="round" strokeLinejoin="round"
              pointerEvents="none" />
          )}

          {/* ── Draw preview (in-progress arrow / ellipse) ────────────── */}
          {drawStart.current && drawCurrent && (() => {
            const { cx: sx, cy: sy } = drawStart.current!;
            const { cx: ex, cy: ey } = drawCurrent;
            if (tool === "draw_arrow") {
              return (
                <line x1={sx} y1={sy} x2={ex} y2={ey}
                  stroke="#64748b" strokeWidth={2} strokeDasharray="6 4"
                  strokeLinecap="round" pointerEvents="none" />
              );
            }
            if (tool === "draw_ellipse") {
              const x = Math.min(sx, ex), y = Math.min(sy, ey);
              const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
              return (
                <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.max(w / 2, 1)} ry={Math.max(h / 2, 1)}
                  fill="none" stroke="#64748b" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
              );
            }
            return null;
          })()}

          {/* ── Polygon in-progress preview ───────────────────────────── */}
          {tool === "draw_polygon" && polygonPts.length > 0 && (() => {
            const d = polygonPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            return (
              <g pointerEvents="none">
                <path d={d} fill="none" stroke="#64748b" strokeWidth={2} strokeDasharray="6 4"
                  strokeLinecap="round" strokeLinejoin="round" />
                {polygonPts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4}
                    fill={i === 0 ? "#3b82f6" : "var(--bg-base)"} stroke="#64748b" strokeWidth={1.5} />
                ))}
              </g>
            );
          })()}

          {/* Dividers */}
          {dividerBlocks.map(div => {
            const sel = selectedId === div.id || selectedIds.has(div.id);
            const da = div.divStyle === "dashed" ? "10 7" : div.divStyle === "dotted" ? "2 7" : undefined;
            return (
              <g key={div.id}>
                <line x1={div.x} y1={div.y} x2={div.x2} y2={div.y2}
                  stroke="transparent" strokeWidth={14} pointerEvents="stroke" style={{ cursor: "move" }}
                  onPointerDown={e => onDividerPointerDown(e, div)} />
                <line x1={div.x} y1={div.y} x2={div.x2} y2={div.y2}
                  stroke={sel ? "var(--fg-secondary)" : "var(--border-strong)"}
                  strokeWidth={sel ? 2 : 1.5} strokeDasharray={da} strokeLinecap="round" pointerEvents="none" />
                {sel && (
                  <>
                    <circle cx={div.x} cy={div.y} r={5}
                      fill="var(--bg-base)" stroke="var(--border-strong)" strokeWidth={1.5}
                      style={{ cursor: "grab" }}
                      onPointerDown={e => onDividerEndpointPointerDown(e, div, "p1")} />
                    <circle cx={div.x2} cy={div.y2} r={5}
                      fill="var(--bg-base)" stroke="var(--border-strong)" strokeWidth={1.5}
                      style={{ cursor: "grab" }}
                      onPointerDown={e => onDividerEndpointPointerDown(e, div, "p2")} />
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {/* Divider floating toolbar */}
        {dividerBlocks.filter(div => selectedId === div.id).map(div => (
          <div key={div.id + "-tb"} className="canvas-divider-float-toolbar"
            style={{ left: (div.x + div.x2) / 2, top: Math.min(div.y, div.y2) - 36 }}
            onPointerDown={e => e.stopPropagation()}>
            {(["solid", "dashed", "dotted"] as const).map(s => (
              <button key={s} className={`canvas-divider-style-btn${div.divStyle === s ? " active" : ""}`}
                onClick={() => updateBlock(div.id, { divStyle: s })} title={s}>
                {s === "solid" ? "—" : s === "dashed" ? "╌╌" : "⋯"}
              </button>
            ))}
            <div className="canvas-divider-float-sep" />
            <button className="canvas-block-close" onClick={() => deleteBlock(div.id)}>×</button>
          </div>
        ))}

        {/* Draw shape floating toolbars */}
        {data.blocks.filter((b): b is DrawArrowBlock => b.type === "draw_arrow" && selectedId === b.id).map(da => (
          <div key={da.id + "-tb"} className="canvas-divider-float-toolbar ds-float-toolbar"
            style={{ left: (da.x + da.x2) / 2, top: Math.min(da.y, da.y2) - 44 }}
            onPointerDown={e => e.stopPropagation()}>
            {DRAW_COLORS.map(c => (
              <button key={c} className={`ds-color-btn${da.color === c ? " active" : ""}`}
                style={{ background: c, outlineColor: c }} onClick={() => updateBlock(da.id, { color: c })} />
            ))}
            <div className="canvas-divider-float-sep" />
            {[1.5, 2.5, 4].map(w => (
              <button key={w} className={`canvas-divider-style-btn${da.strokeWidth === w ? " active" : ""}`}
                onClick={() => updateBlock(da.id, { strokeWidth: w })}>
                <span style={{ display:"block", height: w < 2 ? "1.5px" : w < 3 ? "2.5px" : "4px", width:14, background:"currentColor", borderRadius:1 }} />
              </button>
            ))}
            <div className="canvas-divider-float-sep" />
            <button className={`canvas-divider-style-btn${da.dashed ? " active" : ""}`}
              onClick={() => updateBlock(da.id, { dashed: !da.dashed })} title="Dashed">╌╌</button>
            <div className="canvas-divider-float-sep" />
            <button className={`canvas-divider-style-btn${da.headStart ? " active" : ""}`}
              onClick={() => updateBlock(da.id, { headStart: !da.headStart })} title="Head at start">◄—</button>
            <button className={`canvas-divider-style-btn${da.headEnd ? " active" : ""}`}
              onClick={() => updateBlock(da.id, { headEnd: !da.headEnd })} title="Head at end">—►</button>
            <div className="canvas-divider-float-sep" />
            <button className="canvas-block-close" onClick={() => deleteBlock(da.id)}>×</button>
          </div>
        ))}
        {[
          ...data.blocks.filter((b): b is DrawEllipseBlock => b.type === "draw_ellipse" && selectedId === b.id),
          ...data.blocks.filter((b): b is DrawPolygonBlock => b.type === "draw_polygon" && selectedId === b.id),
        ].map(ds => {
          const bTop = ds.type === "draw_ellipse" ? ds.y : Math.min(...(ds as DrawPolygonBlock).points.map(p => p.y));
          const bMidX = ds.type === "draw_ellipse" ? ds.x + ds.width / 2 : ((ds as DrawPolygonBlock).points.reduce((s, p) => s + p.x, 0) / (ds as DrawPolygonBlock).points.length);
          return (
            <div key={ds.id + "-tb"} className="canvas-divider-float-toolbar ds-float-toolbar"
              style={{ left: bMidX, top: bTop - 44 }}
              onPointerDown={e => e.stopPropagation()}>
              {DRAW_COLORS.map(c => (
                <button key={c} className={`ds-color-btn${ds.color === c ? " active" : ""}`}
                  style={{ background: c, outlineColor: c }} onClick={() => updateBlock(ds.id, { color: c })} />
              ))}
              <div className="canvas-divider-float-sep" />
              {DRAW_FILLS.map((f, i) => (
                <button key={i} className={`ds-color-btn ds-fill-btn${ds.fill === f ? " active" : ""}`}
                  style={{ background: f === "none" ? "transparent" : f, border: f === "none" ? "1px dashed var(--border-base)" : undefined, outlineColor: ds.color }}
                  onClick={() => updateBlock(ds.id, { fill: f })} />
              ))}
              <div className="canvas-divider-float-sep" />
              {[1.5, 2.5, 4].map(w => (
                <button key={w} className={`canvas-divider-style-btn${ds.strokeWidth === w ? " active" : ""}`}
                  onClick={() => updateBlock(ds.id, { strokeWidth: w })}>
                  <span style={{ display:"block", height: w < 2 ? "1.5px" : w < 3 ? "2.5px" : "4px", width:14, background:"currentColor", borderRadius:1 }} />
                </button>
              ))}
              <div className="canvas-divider-float-sep" />
              <button className={`canvas-divider-style-btn${ds.dashed ? " active" : ""}`}
                onClick={() => updateBlock(ds.id, { dashed: !ds.dashed })} title="Dashed">╌╌</button>
              <div className="canvas-divider-float-sep" />
              <button className="canvas-block-close" onClick={() => deleteBlock(ds.id)}>×</button>
            </div>
          );
        })}

        {/* Ink stroke floating toolbar */}
        {inkStrokeBlocks.filter(ib => selectedId === ib.id).map(ib => (
          <div key={ib.id + "-tb"} className="canvas-divider-float-toolbar ds-float-toolbar"
            style={{ left: ib.x + ib.width / 2, top: ib.y - 44 }}
            onPointerDown={e => e.stopPropagation()}>
            {DRAW_COLORS.map(c => (
              <button key={c} className={`ds-color-btn${ib.color === c ? " active" : ""}`}
                style={{ background: c, outlineColor: c }}
                onClick={() => updateBlock(ib.id, { color: c })} />
            ))}
            <div className="canvas-divider-float-sep" />
            {[1.5, 2.5, 4].map(w => (
              <button key={w} className={`canvas-divider-style-btn${ib.strokeWidth === w ? " active" : ""}`}
                onClick={() => updateBlock(ib.id, { strokeWidth: w })}>
                <span style={{ display:"block", height: w < 2 ? "1.5px" : w < 3 ? "2.5px" : "4px", width:14, background:"currentColor", borderRadius:1 }} />
              </button>
            ))}
            <div className="canvas-divider-float-sep" />
            <button className="canvas-block-close" onClick={() => deleteBlock(ib.id)}>×</button>
          </div>
        ))}

        {/* Polygon in-progress hint */}
        {tool === "draw_polygon" && polygonPts.length > 0 && (
          <div className="ds-poly-hint" onPointerDown={e => e.stopPropagation()}>
            {polygonPts.length} pts · Enter or double-click to finish · Esc to cancel
          </div>
        )}

        {/* Lasso rectangle */}
        {lassoRect && (
          <div className="canvas-lasso-rect" style={{
            left:   Math.min(lassoRect.x1, lassoRect.x2),
            top:    Math.min(lassoRect.y1, lassoRect.y2),
            width:  Math.abs(lassoRect.x2 - lassoRect.x1),
            height: Math.abs(lassoRect.y2 - lassoRect.y1),
          }} />
        )}

        {/* Blocks */}
        {blockElements}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <>
          <div className="canvas-context-backdrop" onPointerDown={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null); }} />
          <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={e => e.stopPropagation()}>
            <button onClick={() => {
              const b = data.blocks.find(b => b.id === contextMenu.blockId);
              if (b) {
                pushUndo();
                const clone = { ...deepCloneBlock(b), x: b.x + 30, y: b.y + 30 };
                setData(d => ({ ...d, blocks: [...d.blocks, clone] }));
                setSelectedId(clone.id); setSelectedIds(new Set([clone.id])); setSelectedArrowId(null);
              }
              setContextMenu(null);
            }}>Duplicate</button>
            <button className="canvas-context-menu-danger" onClick={() => {
              const id = contextMenu.blockId;
              setContextMenu(null);
              deleteBlock(id);
            }}>Delete</button>
          </div>
        </>
      )}

      {/* ── Snap guides — rendered in screen space so they stay 1 px sharp ── */}
      {snapGuides.map((g, i) =>
        g.type === "v" ? (
          <div key={i} className="canvas-snap-guide canvas-snap-guide-v"
            style={{ left: Math.round(g.pos * zoom + x) }} />
        ) : (
          <div key={i} className="canvas-snap-guide canvas-snap-guide-h"
            style={{ top: Math.round(g.pos * zoom + y) }} />
        )
      )}

      {/* ── Mini-map (top-right, always visible) ── */}
      {(() => {
        const MW = 134, MH = 100;
        const cb = contentBounds;
        const scl = Math.min(MW / Math.max(cb.w, 1), MH / Math.max(cb.h, 1), 1) * 0.7;
        const ox = (MW - cb.w * scl) / 2;
        const oy = (MH - cb.h * scl) / 2;
        const mx = (wx: number) => (wx - cb.x) * scl + ox;
        const my = (wy: number) => (wy - cb.y) * scl + oy;
        const el = containerRef.current;
        const cw = el?.clientWidth ?? 900, ch = el?.clientHeight ?? 600;
        const vpL = -viewport.x / viewport.zoom, vpT = -viewport.y / viewport.zoom;
        const vpW = cw / viewport.zoom, vpH = ch / viewport.zoom;
        return (
          <div className={`canvas-minimap-panel${showOverview ? " visible" : ""}`} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
            <svg width={MW} height={MH}>
              {data.blocks.map(b => {
                if (b.type === "divider") return (
                  <line key={b.id} x1={mx(b.x)} y1={my(b.y)} x2={mx(b.x2)} y2={my(b.y2)}
                    stroke="#94a3b8" strokeWidth={1} />
                );
                return (
                  <rect key={b.id}
                    x={mx(b.x)} y={my(b.y)}
                    width={Math.max(2, b.width * scl)} height={Math.max(2, b.height * scl)}
                    fill={miniBlockFill(b)} stroke="#cbd5e1" strokeWidth={0.5} rx={1}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigateTo(b)} />
                );
              })}
              <rect x={mx(vpL)} y={my(vpT)} width={vpW * scl} height={vpH * scl}
                fill="none" stroke="#6366f1" strokeWidth={1.5} rx={2} style={{ pointerEvents: "none" }} />
            </svg>
          </div>
        );
      })()}

      {/* ── Pan overview (bottom-right node graph, fades in while panning) ── */}
      {(() => {
        const OW = 240, OH = 180;
        const cb = contentBounds;
        const scl = Math.min(OW / Math.max(cb.w, 1), OH / Math.max(cb.h, 1));
        const ox = (OW - cb.w * scl) / 2;
        const oy = (OH - cb.h * scl) / 2;
        const nmx = (wx: number) => (wx - cb.x) * scl + ox;
        const nmy = (wy: number) => (wy - cb.y) * scl + oy;
        const titleBlocks = data.blocks.filter(b => b.type === "title");
        return (
          <div className="canvas-pan-overview"
            onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
            <svg width={OW} height={OH}>
              <defs>
                <marker id="ov-arrow" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto">
                  <polygon points="0 0, 4 2, 0 4" fill="rgba(148,163,184,0.8)" />
                </marker>
              </defs>
              {/* Bezier arrows between connected title blocks */}
              {data.arrows.map(arrow => {
                const from = titleBlocks.find(b => b.id === arrow.fromId);
                const to   = titleBlocks.find(b => b.id === arrow.toId);
                if (!from || !to) return null;
                const x1 = nmx(from.x + from.width / 2), y1 = nmy(from.y + from.height / 2);
                const x2 = nmx(to.x   + to.width   / 2), y2 = nmy(to.y   + to.height   / 2);
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const r = 4;
                // Shorten endpoints to node edge
                const sx = x1 + (dx / len) * r, sy = y1 + (dy / len) * r;
                const ex = x2 - (dx / len) * (r + 3), ey = y2 - (dy / len) * (r + 3);
                // Cubic bezier: control points offset perpendicular to the line
                const cx1 = sx + dx * 0.4, cy1 = sy + dy * 0.4;
                const cx2 = ex - dx * 0.4, cy2 = ey - dy * 0.4;
                return (
                  <path key={arrow.id}
                    d={`M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${ex},${ey}`}
                    stroke="rgba(148,163,184,0.7)" strokeWidth={0.9}
                    fill="none" markerEnd="url(#ov-arrow)" />
                );
              })}
              {/* Title blocks as nodes */}
              {titleBlocks.map(b => (
                <circle key={b.id}
                  cx={nmx(b.x + b.width / 2)} cy={nmy(b.y + b.height / 2)}
                  r={4}
                  fill="#fb923c" stroke="rgba(255,255,255,0.9)" strokeWidth={1}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigateTo(b)} />
              ))}
            </svg>
          </div>
        );
      })()}
    </div>
  );
}
