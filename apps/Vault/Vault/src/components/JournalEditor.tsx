import { useState, useRef, useEffect } from "react";
import * as api from "../lib/api";

// ── Data types ──────────────────────────────────────────────────────────────

interface Point { x: number; y: number; pressure: number }

interface Stroke {
  id: string;
  tool: "pen" | "highlighter" | "eraser";
  color: string;
  width: number;
  opacity: number;
  points: Point[];
}

interface JournalData {
  version: number;
  strokes: Stroke[];
  background: "blank" | "lined" | "dotted" | "grid";
}

type Tool = "pen" | "highlighter" | "eraser";

interface Transform { x: number; y: number; scale: number }

// ── Constants ────────────────────────────────────────────────────────────────

const ERASER_RADIUS = 20;
const LINE_SPACING = 32;
const DOT_SPACING = 32;
const PAGE_BG = "#fafaf8";
const LINE_COLOR = "#dce3ea";
const DOT_COLOR = "#c8d3dc";
const GRID_COLOR = "#dce3ea";

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    const r = (stroke.width * pts[0].pressure) / 2;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    const w = stroke.width * pts[i].pressure;
    ctx.lineWidth = Math.max(w, 0.5);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  ctx.lineWidth = Math.max(stroke.width * last.pressure, 0.5);
  ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, bg: JournalData["background"], viewW: number, viewH: number, transform: Transform) {
  // Fill page
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, viewW, viewH);

  const offsetX = transform.x % (DOT_SPACING * transform.scale);
  const offsetY = transform.y % (LINE_SPACING * transform.scale);

  if (bg === "lined") {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 0.8;
    const spacing = LINE_SPACING * transform.scale;
    const startY = offsetY % spacing;
    for (let y = startY; y < viewH; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }
  } else if (bg === "dotted") {
    const spacing = DOT_SPACING * transform.scale;
    const sx = offsetX % spacing;
    const sy = offsetY % spacing;
    ctx.fillStyle = DOT_COLOR;
    for (let x = sx; x < viewW; x += spacing) {
      for (let y = sy; y < viewH; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (bg === "grid") {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.8;
    const spacing = LINE_SPACING * transform.scale;
    const sx = offsetX % spacing;
    const sy = offsetY % spacing;
    for (let x = sx; x < viewW; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewH);
      ctx.stroke();
    }
    for (let y = sy; y < viewH; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
      ctx.stroke();
    }
  }
}

function toCanvas(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement, transform: Transform) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left - transform.x) / transform.scale;
  const cy = (e.clientY - rect.top - transform.y) / transform.scale;
  return { x: cx, y: cy };
}

function strokeHitTest(stroke: Stroke, px: number, py: number, radius: number): boolean {
  for (const pt of stroke.points) {
    const dx = pt.x - px;
    const dy = pt.y - py;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  nodeId: string;
}

export function JournalEditor({ nodeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<JournalData>({ version: 1, strokes: [], background: "lined" });
  const dataRef = useRef(data);
  dataRef.current = data;

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1a2e");
  const [width, setWidth] = useState(2.5);
  const setLoaded = useState(false)[1];

  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const [transform, setTransformState] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  function setTransform(t: Transform) {
    transformRef.current = t;
    setTransformState(t);
  }

  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(true);

  // Touch state for pan/zoom
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchCenterRef = useRef<{ x: number; y: number } | null>(null);

  // Save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function scheduleSave(d: JournalData) {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.saveJournal(nodeId, JSON.stringify(d));
    }, 600);
  }

  // Load on mount / nodeId change
  useEffect(() => {
    setLoaded(false);
    api.readJournal(nodeId).then(raw => {
      try {
        const parsed = JSON.parse(raw) as JournalData;
        setData(parsed);
        dataRef.current = parsed;
      } catch {
        const empty: JournalData = { version: 1, strokes: [], background: "lined" };
        setData(empty);
        dataRef.current = empty;
      }
      dirtyRef.current = true;
      setLoaded(true);
    });
    return () => clearTimeout(saveTimerRef.current);
  }, [nodeId]);

  // Resize canvas to fill container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    function resize() {
      canvas!.width = container!.offsetWidth;
      canvas!.height = container!.offsetHeight;
      dirtyRef.current = true;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Render loop
  useEffect(() => {
    function loop() {
      if (dirtyRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d")!;
          const t = transformRef.current;
          const d = dataRef.current;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawBackground(ctx, d.background, canvas.width, canvas.height, t);
          ctx.save();
          ctx.translate(t.x, t.y);
          ctx.scale(t.scale, t.scale);
          for (const stroke of d.strokes) drawStroke(ctx, stroke);
          if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
          ctx.restore();
        }
        dirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Pointer events (pen / mouse drawing) ──

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    // Only draw with pen or mouse; touch is for navigation (handled separately)
    if (e.pointerType === "touch") return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const canvas = canvasRef.current!;
    const pt = toCanvas(e, canvas, transformRef.current);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (tool === "eraser") {
      currentStrokeRef.current = { id: uid(), tool: "eraser", color: "#000", width: ERASER_RADIUS * 2, opacity: 1, points: [{ ...pt, pressure: 1 }] };
    } else {
      currentStrokeRef.current = {
        id: uid(),
        tool,
        color: tool === "highlighter" ? color : color,
        width: tool === "highlighter" ? width * 4 : width,
        opacity: tool === "highlighter" ? 0.3 : 1,
        points: [{ ...pt, pressure }],
      };
    }
    dirtyRef.current = true;
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") return;
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const pt = toCanvas(e, canvas, transformRef.current);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (tool === "eraser") {
      // Erase strokes hit by the eraser
      const radius = ERASER_RADIUS / transformRef.current.scale;
      const newStrokes = dataRef.current.strokes.filter(s => !strokeHitTest(s, pt.x, pt.y, radius));
      if (newStrokes.length !== dataRef.current.strokes.length) {
        const next = { ...dataRef.current, strokes: newStrokes };
        setData(next);
        dataRef.current = next;
        scheduleSave(next);
      }
    } else {
      currentStrokeRef.current.points.push({ ...pt, pressure });
    }
    dirtyRef.current = true;
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") return;
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (currentStrokeRef.current && tool !== "eraser" && currentStrokeRef.current.points.length > 0) {
      const stroke = currentStrokeRef.current;
      const next = { ...dataRef.current, strokes: [...dataRef.current.strokes, stroke] };
      setData(next);
      dataRef.current = next;
      scheduleSave(next);
    }
    currentStrokeRef.current = null;
    dirtyRef.current = true;
  }

  // ── Touch events (pan / zoom navigation) ──

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (touchesRef.current.size === 2) {
      const pts = Array.from(touchesRef.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      lastPinchCenterRef.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const prev = new Map(touchesRef.current);
    for (const t of Array.from(e.changedTouches)) {
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    if (touchesRef.current.size === 1) {
      // Pan with single finger
      const [id] = touchesRef.current.keys();
      const curr = touchesRef.current.get(id)!;
      const old = prev.get(id);
      if (old) {
        const dx = curr.x - old.x;
        const dy = curr.y - old.y;
        const t = transformRef.current;
        setTransform({ ...t, x: t.x + dx, y: t.y + dy });
        dirtyRef.current = true;
      }
    } else if (touchesRef.current.size === 2) {
      // Pinch zoom + pan
      const pts = Array.from(touchesRef.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;

      if (lastPinchDistRef.current !== null && lastPinchCenterRef.current !== null) {
        const scaleFactor = dist / lastPinchDistRef.current;
        const panX = cx - lastPinchCenterRef.current.x;
        const panY = cy - lastPinchCenterRef.current.y;
        const t = transformRef.current;
        const newScale = Math.min(Math.max(t.scale * scaleFactor, 0.2), 5);
        const originX = cx - rect.left;
        const originY = cy - rect.top;
        const newX = originX - (originX - t.x) * (newScale / t.scale) + panX;
        const newY = originY - (originY - t.y) * (newScale / t.scale) + panY;
        setTransform({ x: newX, y: newY, scale: newScale });
        dirtyRef.current = true;
      }
      lastPinchDistRef.current = dist;
      lastPinchCenterRef.current = { x: cx, y: cy };
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      touchesRef.current.delete(t.identifier);
    }
    if (touchesRef.current.size < 2) {
      lastPinchDistRef.current = null;
      lastPinchCenterRef.current = null;
    }
  }

  // ── Mouse wheel zoom ──
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const originX = e.clientX - rect.left;
    const originY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const t = transformRef.current;
    const newScale = Math.min(Math.max(t.scale * factor, 0.2), 5);
    const newX = originX - (originX - t.x) * (newScale / t.scale);
    const newY = originY - (originY - t.y) * (newScale / t.scale);
    setTransform({ x: newX, y: newY, scale: newScale });
    dirtyRef.current = true;
  }

  // Background change
  function changeBackground(bg: JournalData["background"]) {
    const next = { ...dataRef.current, background: bg };
    setData(next);
    dataRef.current = next;
    dirtyRef.current = true;
    scheduleSave(next);
  }

  // Undo last stroke
  function undo() {
    if (dataRef.current.strokes.length === 0) return;
    const next = { ...dataRef.current, strokes: dataRef.current.strokes.slice(0, -1) };
    setData(next);
    dataRef.current = next;
    dirtyRef.current = true;
    scheduleSave(next);
  }

  return (
    <div className="journal-container" ref={containerRef}>
      {/* Toolbar */}
      <div className="journal-toolbar">
        {/* Tools */}
        <div className="journal-tool-group">
          <button
            className={`journal-tool-btn${tool === "pen" ? " active" : ""}`}
            onClick={() => setTool("pen")}
            title="Pen"
          >✏️</button>
          <button
            className={`journal-tool-btn${tool === "highlighter" ? " active" : ""}`}
            onClick={() => setTool("highlighter")}
            title="Highlighter"
          >🖊️</button>
          <button
            className={`journal-tool-btn${tool === "eraser" ? " active" : ""}`}
            onClick={() => setTool("eraser")}
            title="Eraser"
          >⌫</button>
        </div>

        <div className="journal-divider" />

        {/* Color */}
        <input
          type="color"
          className="journal-color-picker"
          value={color}
          onChange={e => setColor(e.target.value)}
          title="Ink color"
        />

        {/* Width */}
        <div className="journal-tool-group">
          {[1.5, 2.5, 4].map(w => (
            <button
              key={w}
              className={`journal-width-btn${width === w ? " active" : ""}`}
              onClick={() => setWidth(w)}
              title={`Width ${w}`}
            >
              <span style={{ width: w * 3, height: w * 3, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
            </button>
          ))}
        </div>

        <div className="journal-divider" />

        {/* Background */}
        <div className="journal-tool-group">
          {(["blank", "lined", "dotted", "grid"] as const).map(bg => (
            <button
              key={bg}
              className={`journal-bg-btn${data.background === bg ? " active" : ""}`}
              onClick={() => changeBackground(bg)}
              title={bg}
            >{bg[0].toUpperCase()}</button>
          ))}
        </div>

        <div className="journal-divider" />

        <button className="journal-tool-btn" onClick={undo} title="Undo last stroke">↩</button>

        {/* Zoom level */}
        <span className="journal-zoom-label">{Math.round(transform.scale * 100)}%</span>
        <button className="journal-tool-btn" onClick={() => { setTransform({ x: 0, y: 0, scale: 1 }); dirtyRef.current = true; }} title="Reset zoom">⊙</button>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="journal-canvas"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      />
    </div>
  );
}
