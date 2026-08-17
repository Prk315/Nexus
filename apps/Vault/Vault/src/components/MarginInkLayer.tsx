import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as api from "../lib/api";

// ── Data types ──────────────────────────────────────────────────────────────
// Document coords = position relative to `.parsed-content`'s own top-left
// (its content/offset box), NOT the scroll container. x can be negative
// (left margin) or greater than the column width (right margin) — strokes
// ride with the column as it scrolls/centers because we always re-derive the
// on-screen position from `contentEl.getBoundingClientRect()` at paint time.

interface MarginStroke {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  pts: number[]; // flat [x, y, pressure, x, y, pressure, ...] in document coords
}

interface MarginData {
  v: 1;
  strokes: MarginStroke[];
}

type MarginTool = "pen" | "highlighter" | "eraser";

export interface MarginInkHandle {
  undo(): void;
  /** Current committed stroke count — a paint-independent probe for tests
   *  and a cheap way for the host to know whether margins hold anything. */
  count(): number;
}

interface Props {
  nodeId: string;
  scrollEl: HTMLDivElement | null;
  contentEl: HTMLDivElement | null;
  enabled: boolean;
  tool: MarginTool;
  color: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_WIDTH = 2.2;
const ERASER_RADIUS = 14; // document px
const SAVE_DEBOUNCE_MS = 600;
const UNDO_CAP = 50;
const EMPTY_DATA: MarginData = { v: 1, strokes: [] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

// Whole-stroke eraser: any stroke with a point within `radius` doc-px of `pt`.
function strokeHit(s: MarginStroke, px: number, py: number, radius: number): boolean {
  for (let i = 0; i < s.pts.length; i += 3) {
    const dx = s.pts[i] - px, dy = s.pts[i + 1] - py;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

function drawMarginStroke(ctx: CanvasRenderingContext2D, s: MarginStroke, offsetX: number, offsetY: number) {
  const n = s.pts.length / 3;
  if (n === 0) return;
  const isHl = s.tool === "highlighter";
  const widthMul = isHl ? 3 : 1;
  const px = (i: number) => offsetX + s.pts[i * 3];
  const py = (i: number) => offsetY + s.pts[i * 3 + 1];
  const pp = (i: number) => s.pts[i * 3 + 2];

  ctx.save();
  ctx.globalAlpha = isHl ? 0.35 : 1;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = isHl ? "butt" : "round";
  ctx.lineJoin = "round";

  if (n === 1) {
    const r = Math.max((s.width * widthMul * (0.5 + pp(0))) / 2, 0.5);
    ctx.beginPath();
    ctx.arc(px(0), py(0), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(px(0), py(0));
  for (let i = 1; i < n - 1; i++) {
    const mx = (px(i) + px(i + 1)) / 2;
    const my = (py(i) + py(i + 1)) / 2;
    const avgP = (pp(i - 1) + pp(i)) / 2;
    ctx.lineWidth = Math.max(s.width * widthMul * (0.5 + avgP), 0.5);
    ctx.quadraticCurveTo(px(i), py(i), mx, my);
  }
  const last = n - 1, prev = n - 2;
  const avgP = (pp(prev) + pp(last)) / 2;
  ctx.lineWidth = Math.max(s.width * widthMul * (0.5 + avgP), 0.5);
  ctx.quadraticCurveTo(px(prev), py(prev), px(last), py(last));
  ctx.stroke();
  ctx.restore();
}

function serialize(d: MarginData): string {
  // Round to 1 decimal on save — live drawing keeps full precision.
  return JSON.stringify({
    v: 1,
    strokes: d.strokes.map(s => ({ ...s, pts: s.pts.map(n => Math.round(n * 10) / 10) })),
  });
}

type UndoOp = { kind: "add"; id: string } | { kind: "erase"; strokes: MarginStroke[] };

// ── Component ────────────────────────────────────────────────────────────────

export const MarginInkLayer = forwardRef<MarginInkHandle, Props>(function MarginInkLayer(
  { nodeId, scrollEl, contentEl, enabled, tool, color },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<MarginData>(EMPTY_DATA);
  const contentElRef = useRef<HTMLDivElement | null>(contentEl);
  const dirtyRef = useRef(true);
  const rafRef = useRef<number>(0);

  const currentStrokeRef = useRef<MarginStroke | null>(null);
  const isDrawingRef = useRef(false);
  const isErasingRef = useRef(false);
  const erasedThisGestureRef = useRef<MarginStroke[]>([]);
  const undoStackRef = useRef<UndoOp[]>([]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function scheduleSave(d: MarginData) {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.saveContent(`${nodeId}_margins`, serialize(d)).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  // Keep the latest contentEl available to the rAF loop, which is mounted once.
  // Also force a fresh canvas-size read right here: ParsedViewer hands this
  // element down via a callback-ref-fed state update (see its comment), which
  // lands a render or two after MarginInkLayer's own mount. The very first
  // ResizeObserver callback below can fire before that layout has settled —
  // this is the belt-and-braces re-measure once the real element is in.
  useEffect(() => {
    contentElRef.current = contentEl;
    dirtyRef.current = true;
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
  }, [contentEl]);

  // ── Load on mount / nodeId change ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let d: MarginData = { v: 1, strokes: [] };
      try {
        const raw = await api.readContent(`${nodeId}_margins`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.strokes)) d = { v: 1, strokes: parsed.strokes };
        }
      } catch { /* corrupt or missing — start fresh */ }
      if (!cancelled) {
        dataRef.current = d;
        undoStackRef.current = [];
        dirtyRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  // Flush a pending save on unmount / nodeId change.
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current);
      api.saveContent(`${nodeId}_margins`, serialize(dataRef.current)).catch(() => {});
    };
  }, [nodeId]);

  // ── Canvas sizing (devicePixelRatio-aware) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
      dirtyRef.current = true;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Repaint on scroll (both axes — margins mode adds horizontal scroll too) ──
  useEffect(() => {
    if (!scrollEl) return;
    function onScroll() { dirtyRef.current = true; }
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // Repaint when capture toggles (pointer-events / cursor change, strokes may
  // now be interactive) and whenever nodeId's freshly-loaded data lands.
  useEffect(() => { dirtyRef.current = true; }, [enabled]);

  // ── rAF redraw loop: full repaint, translating document→viewport via the
  // live bounding rects of the canvas and `.parsed-content` each paint. This
  // is robust to scroll in both axes and to the column being centered — no
  // manual scrollTop bookkeeping needed. ──
  useEffect(() => {
    function loop() {
      if (dirtyRef.current) {
        const canvas = canvasRef.current;
        const content = contentElRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d")!;
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
          if (content) {
            const canvasRect = canvas.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const offsetX = contentRect.left - canvasRect.left;
            const offsetY = contentRect.top - canvasRect.top;
            const strokes = dataRef.current.strokes;
            // Highlighters underlay, pens on top.
            for (const s of strokes) if (s.tool === "highlighter") drawMarginStroke(ctx, s, offsetX, offsetY);
            for (const s of strokes) if (s.tool !== "highlighter") drawMarginStroke(ctx, s, offsetX, offsetY);
            if (currentStrokeRef.current) drawMarginStroke(ctx, currentStrokeRef.current, offsetX, offsetY);
          }
        }
        dirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── iPad Safari + Apple Pencil: a Pencil drag is also reported as a touch,
  // and by default that touch pans the scroll container, cancelling the
  // pointer-driven stroke mid-draw. Prevent only the stylus touch from
  // scrolling; finger touches are left untouched so they keep scrolling the
  // book. Must be a native non-passive listener — React's touch listeners
  // are passive. (Same trick as PdfViewer.tsx's annotCanvasRef effect.) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    const onTouchMove = (e: TouchEvent) => {
      const touches = Array.from(e.touches) as Array<Touch & { touchType?: string }>;
      if (touches.some(t => t.touchType === "stylus")) e.preventDefault();
    };
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => canvas.removeEventListener("touchmove", onTouchMove);
  }, [enabled]);

  // ── Doc-coord conversion ──
  function toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const el = contentEl;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ── Undo ──
  function pushUndo(op: UndoOp) {
    const st = undoStackRef.current;
    st.push(op);
    if (st.length > UNDO_CAP) st.shift();
  }

  function undo() {
    const op = undoStackRef.current.pop();
    if (!op) return;
    if (op.kind === "add") {
      dataRef.current = { ...dataRef.current, strokes: dataRef.current.strokes.filter(s => s.id !== op.id) };
    } else {
      dataRef.current = { ...dataRef.current, strokes: [...dataRef.current.strokes, ...op.strokes] };
    }
    dirtyRef.current = true;
    scheduleSave(dataRef.current);
  }

  useImperativeHandle(ref, () => ({ undo, count: () => dataRef.current.strokes.length }));

  // Dev-only test probe: paint-independent access to the same handle the
  // host uses. import.meta.env.DEV is statically false in production builds,
  // so this whole block is dead-code-eliminated from the bundle.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__marginInk = { undo, count: () => dataRef.current.strokes.length };
    return () => { delete (window as any).__marginInk; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd/Ctrl+Z undoes the last margin op — only while margins mode is active,
  // capture phase so it doesn't leak into other editors' own undo handling.
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Eraser ──
  function eraseAt(pt: { x: number; y: number }) {
    const remaining: MarginStroke[] = [];
    const removed: MarginStroke[] = [];
    for (const s of dataRef.current.strokes) {
      (strokeHit(s, pt.x, pt.y, ERASER_RADIUS) ? removed : remaining).push(s);
    }
    if (removed.length) {
      erasedThisGestureRef.current.push(...removed);
      dataRef.current = { ...dataRef.current, strokes: remaining };
      dirtyRef.current = true;
    }
  }

  // ── Pointer capture (pen + mouse only — touch always scrolls the book) ──
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!enabled) return;
    if (e.pointerType === "touch") return;
    e.preventDefault();
    try { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const pt = toDoc(e.clientX, e.clientY);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    if (tool === "eraser") {
      isErasingRef.current = true;
      erasedThisGestureRef.current = [];
      eraseAt(pt);
    } else {
      isDrawingRef.current = true;
      currentStrokeRef.current = {
        id: uid(),
        tool,
        color,
        width: BASE_WIDTH,
        pts: [pt.x, pt.y, pressure],
      };
    }
    dirtyRef.current = true;
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") return;
    if (isErasingRef.current) {
      if (e.buttons === 0) return;
      e.preventDefault();
      eraseAt(toDoc(e.clientX, e.clientY));
      return;
    }
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const pts = currentStrokeRef.current.pts;
    for (const ev of events) {
      const pt = toDoc(ev.clientX, ev.clientY);
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      pts.push(pt.x, pt.y, pressure);
    }
    dirtyRef.current = true;
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch") return;
    if (isErasingRef.current) {
      isErasingRef.current = false;
      if (erasedThisGestureRef.current.length) {
        pushUndo({ kind: "erase", strokes: erasedThisGestureRef.current });
        scheduleSave(dataRef.current);
      }
      erasedThisGestureRef.current = [];
      dirtyRef.current = true;
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (stroke && stroke.pts.length >= 3) {
      dataRef.current = { ...dataRef.current, strokes: [...dataRef.current.strokes, stroke] };
      pushUndo({ kind: "add", id: stroke.id });
      scheduleSave(dataRef.current);
    }
    dirtyRef.current = true;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`margin-ink-canvas${enabled ? " margin-ink-active" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
});
