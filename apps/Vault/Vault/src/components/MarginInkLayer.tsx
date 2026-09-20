import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as api from "../lib/api";
import { coalescedOf, emaNext, pressureOf, segmentWidths } from "../lib/marginInkMath";

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

  if (isHl) {
    // One path, one stroke: with 0.35 alpha, per-segment strokes would stack
    // darker at every joint. A highlighter is uniform-width anyway.
    ctx.lineWidth = Math.max(s.width * widthMul, 0.5);
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
    }
    ctx.quadraticCurveTo(px(n - 2), py(n - 2), px(n - 1), py(n - 1));
    ctx.stroke();
    ctx.restore();
    return;
  }

  // ⚠️ Pen: one stroke() PER SEGMENT, because canvas 2D honours a single
  // lineWidth per stroke call — the old code assigned lineWidth while
  // building one long path, which silently applied only the LAST value and
  // rendered every stroke uniform. Pressure was cosmetically dead. Round
  // caps make consecutive opaque segments join seamlessly; midpoint
  // quadratics keep the polyline smooth at 60 Hz mouse rates while the
  // coalesced 240 Hz Pencil samples barely need it.
  const widths = segmentWidths(s.pts, s.width, widthMul);
  let sx = px(0), sy = py(0);
  for (let i = 1; i < n; i++) {
    const ex = i < n - 1 ? (px(i) + px(i + 1)) / 2 : px(i);
    const ey = i < n - 1 ? (py(i) + py(i + 1)) / 2 : py(i);
    ctx.lineWidth = widths[i - 1];
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(px(i), py(i), ex, ey);
    ctx.stroke();
    sx = ex; sy = ey;
  }
  ctx.restore();
}

function serialize(d: MarginData): string {
  // Round to 1 decimal on save — live drawing keeps full precision.
  return JSON.stringify({
    v: 1,
    strokes: d.strokes.map(s => ({ ...s, pts: s.pts.map(n => Math.round(n * 10) / 10) })),
  });
}

// ⚠️ The backing store may never exceed a screen-sized box. The canvas is a
// replaced element, so if any stylesheet change ever lets it fall back to its
// intrinsic (attribute) size again, resize() reading rect×dpr becomes a
// doubling feedback loop on retina displays — see .margin-ink-canvas in
// App.css. This clamp turns that failure back into a drawable canvas instead
// of a dead compositor layer. 8192 covers a 4K portrait display at dpr 2.
const MAX_CANVAS_DIM = 8192;

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
  // Committed-ink cache: a data version stamps every mutation of dataRef, and
  // the paint loop keeps an offscreen canvas of the committed strokes keyed on
  // (version, size, scroll offset). While the pen is down each frame is one
  // blit plus the wet stroke — the #102 lesson from the Canvas ink work:
  // per-frame cost must not scale with everything drawn so far.
  const dataVerRef = useRef(0);
  // Predicted Pencil samples: preview-only tail that cuts perceived latency.
  // Overwritten every move and never pushed into the stroke, so a
  // misprediction can never enter the committed ink.
  const predictedRef = useRef<{ x: number; y: number }[]>([]);
  // Smoothed pressure state for the stroke in progress: the Pencil reports
  // pressure in visible quantisation steps at 240 Hz, and raw values render
  // as a width staircase.
  const penEmaRef = useRef(0.5);
  // Last eraser position (doc coords) — an iPad has no cursor, so the ring
  // drawn at this point is the only feedback of where the eraser bites.
  const erasePosRef = useRef<{ x: number; y: number } | null>(null);
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
      canvas.width = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(rect.width * dpr)));
      canvas.height = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(rect.height * dpr)));
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
        dataVerRef.current++;
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
      canvas!.width = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(rect.width * dpr)));
      canvas!.height = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(rect.height * dpr)));
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

  // ── rAF redraw loop, split wet/dry. The DRY layer (committed strokes) is
  // cached on an offscreen canvas keyed by (data version, size, scroll
  // offset); the live canvas each frame is one blit plus the WET stroke, its
  // predicted tail, and the eraser ring. Before the split, every frame while
  // drawing re-stroked every committed stroke — cost that grew with the
  // amount of ink on the page, which is the shape of latency that creeps in
  // over a term of margin notes. Document→viewport translation still comes
  // from live bounding rects, so scroll in both axes and column centering
  // keep working with no manual bookkeeping. ──
  useEffect(() => {
    const dry = document.createElement("canvas");
    let dryKey = { ver: -1, w: 0, h: 0, ox: NaN, oy: NaN };
    function loop() {
      if (dirtyRef.current) {
        const canvas = canvasRef.current;
        const content = contentElRef.current;
        if (canvas) {
          // desynchronized: a latency hint the compositor may honour by
          // skipping a frame of buffering; ignored where unsupported.
          const ctx = canvas.getContext("2d", { desynchronized: true })!;
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (content) {
            const canvasRect = canvas.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const offsetX = contentRect.left - canvasRect.left;
            const offsetY = contentRect.top - canvasRect.top;

            const ver = dataVerRef.current;
            if (dryKey.ver !== ver || dryKey.w !== canvas.width || dryKey.h !== canvas.height
                || dryKey.ox !== offsetX || dryKey.oy !== offsetY) {
              dry.width = canvas.width;
              dry.height = canvas.height;
              const dctx = dry.getContext("2d")!;
              dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              dctx.clearRect(0, 0, dry.width / dpr, dry.height / dpr);
              const strokes = dataRef.current.strokes;
              for (const st of strokes) if (st.tool === "highlighter") drawMarginStroke(dctx, st, offsetX, offsetY);
              for (const st of strokes) if (st.tool !== "highlighter") drawMarginStroke(dctx, st, offsetX, offsetY);
              dryKey = { ver, w: canvas.width, h: canvas.height, ox: offsetX, oy: offsetY };
            }
            ctx.drawImage(dry, 0, 0);

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const wet = currentStrokeRef.current;
            if (wet) {
              drawMarginStroke(ctx, wet, offsetX, offsetY);
              const pred = predictedRef.current;
              if (pred.length && wet.pts.length >= 3) {
                // The predicted tail rides at reduced alpha so a misprediction
                // reads as a ghost for one frame, never as committed ink.
                const lx = offsetX + wet.pts[wet.pts.length - 3];
                const ly = offsetY + wet.pts[wet.pts.length - 2];
                const lp = wet.pts[wet.pts.length - 1];
                ctx.save();
                ctx.globalAlpha = wet.tool === "highlighter" ? 0.2 : 0.6;
                ctx.strokeStyle = wet.color;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.lineWidth = Math.max(wet.width * (wet.tool === "highlighter" ? 3 : 1) * (0.5 + lp), 0.5);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                for (const pt2 of pred) ctx.lineTo(offsetX + pt2.x, offsetY + pt2.y);
                ctx.stroke();
                ctx.restore();
              }
            }
            const ep = erasePosRef.current;
            if (ep) {
              // The iPad has no cursor, so this ring is the only statement of
              // where the eraser bites — same affordance as the Canvas ink
              // eraser.
              ctx.save();
              ctx.strokeStyle = "rgba(120,120,130,0.9)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(offsetX + ep.x, offsetY + ep.y, ERASER_RADIUS, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }
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
    dataVerRef.current++;
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
      dataVerRef.current++;
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
    const pressure = pressureOf(e);
    penEmaRef.current = pressure;

    if (tool === "eraser") {
      isErasingRef.current = true;
      erasedThisGestureRef.current = [];
      erasePosRef.current = pt;
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
      // Sweep every coalesced sample — at Pencil speeds the parent event
      // alone skips whole strokes between 60 Hz frames.
      for (const ev of coalescedOf(e.nativeEvent)) {
        eraseAt(toDoc(ev.clientX, ev.clientY));
      }
      erasePosRef.current = toDoc(e.clientX, e.clientY);
      dirtyRef.current = true;
      return;
    }
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const pts = currentStrokeRef.current.pts;
    for (const ev of coalescedOf(e.nativeEvent)) {
      const pt = toDoc(ev.clientX, ev.clientY);
      penEmaRef.current = emaNext(penEmaRef.current, pressureOf(ev));
      pts.push(pt.x, pt.y, penEmaRef.current);
    }
    // Preview-only latency cut: draw the browser's predicted samples as the
    // stroke's tail, replaced wholesale on the next real move.
    predictedRef.current = (e.nativeEvent.getPredictedEvents?.() ?? [])
      .map(ev => toDoc(ev.clientX, ev.clientY));
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
      erasePosRef.current = null;
      dirtyRef.current = true;
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (stroke && stroke.pts.length >= 3) {
      dataRef.current = { ...dataRef.current, strokes: [...dataRef.current.strokes, stroke] };
      dataVerRef.current++;
      pushUndo({ kind: "add", id: stroke.id });
      scheduleSave(dataRef.current);
    }
    predictedRef.current = [];
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
