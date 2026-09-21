import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import * as api from "../lib/api";
import { coalescedOf, emaNext, pressureOf, segmentWidths, strokeBounds } from "../lib/marginInkMath";

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
    needPlaceRef.current = true;
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

  // ── Placement: the canvas LIVES IN THE SCROLL LAYER ────────────────────────
  //
  // ⚠️ This is the fix for ink visibly lagging the page. The previous canvas
  // was viewport-fixed and repainted from a scroll listener — but iPadOS
  // scrolls on the compositor thread, so JS sees the scroll AFTER the page
  // has already moved and the ink snaps into place a frame late, every
  // frame. Now the canvas is absolutely positioned INSIDE the scroll
  // container at a document offset, covering the viewport plus one viewport
  // of apron each side: the compositor moves ink and text as one layer and
  // a scroll frame costs NOTHING here. JS only acts when the view nears the
  // apron edge, when data changes, or while a stroke is wet.
  //
  // The content-origin offsets (offX/offY) are measured ONCE per placement:
  // canvas and content share the scroll layer, so their relative position is
  // scroll-invariant — the per-frame getBoundingClientRect pair is gone.
  const placeRef = useRef({ top: 0, cssW: 0, cssH: 0, dpr: 1, offX: 0, offY: 0, valid: false });
  const needPlaceRef = useRef(true);
  // How many points of the wet stroke are already on the canvas — pen ink is
  // drawn INCREMENTALLY in the pointer handler (lowest latency, no clear),
  // and a full repaint resets this to "all of them".
  const wetDrawnRef = useRef(0);

  useEffect(() => {
    const sc = scrollEl;
    if (!sc) return;
    const boundsCache = new WeakMap<MarginStroke, [number, number, number, number]>();

    function place(canvas: HTMLCanvasElement) {
      const content = contentElRef.current;
      const dpr = window.devicePixelRatio || 1;
      const vh = Math.max(1, sc!.clientHeight);
      const cssW = Math.max(1, Math.min(sc!.scrollWidth, Math.floor(MAX_CANVAS_DIM / dpr)));
      const cssH = Math.max(1, Math.min(3 * vh, Math.floor(MAX_CANVAS_DIM / dpr), Math.max(vh, sc!.scrollHeight)));
      const top = Math.max(0, Math.min(sc!.scrollTop - vh, sc!.scrollHeight - cssH));
      canvas.style.top = `${top}px`;
      canvas.style.left = "0px";
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const bw = Math.max(1, Math.round(cssW * dpr));
      const bh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      const cr = content?.getBoundingClientRect();
      const kr = canvas.getBoundingClientRect();
      placeRef.current = {
        top, cssW, cssH, dpr,
        offX: cr && kr ? cr.left - kr.left : 0,
        offY: cr && kr ? cr.top - kr.top : 0,
        valid: true,
      };
      needPlaceRef.current = false;
      dirtyRef.current = true;
    }

    function covered(): boolean {
      const p = placeRef.current;
      if (!p.valid) return false;
      const vh = sc!.clientHeight;
      const topGap = sc!.scrollTop - p.top;
      const botGap = p.top + p.cssH - (sc!.scrollTop + vh);
      if (topGap < vh * 0.33 && p.top > 0) return false;
      if (botGap < vh * 0.33 && p.top + p.cssH < sc!.scrollHeight - 1) return false;
      return true;
    }

    function repaint(canvas: HTMLCanvasElement) {
      const ctx = canvas.getContext("2d", { desynchronized: true });
      if (!ctx) return;
      const p = placeRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      // Cull to the canvas' own document rect — cost tracks the ink NEAR the
      // viewport, never the ink in the whole book.
      const docL = -p.offX, docT = -p.offY;
      const docR = docL + p.cssW, docB = docT + p.cssH;
      const visible: MarginStroke[] = [];
      for (const st of dataRef.current.strokes) {
        let b = boundsCache.get(st);
        if (!b) { b = strokeBounds(st.pts, st.width * 4.5); boundsCache.set(st, b); }
        if (b[2] >= docL && b[0] <= docR && b[3] >= docT && b[1] <= docB) visible.push(st);
      }
      for (const st of visible) if (st.tool === "highlighter") drawMarginStroke(ctx, st, p.offX, p.offY);
      for (const st of visible) if (st.tool !== "highlighter") drawMarginStroke(ctx, st, p.offX, p.offY);
      const wet = currentStrokeRef.current;
      if (wet) {
        drawMarginStroke(ctx, wet, p.offX, p.offY);
        wetDrawnRef.current = wet.pts.length / 3;
      }
      const ep = erasePosRef.current;
      if (ep) {
        // The iPad has no cursor, so this ring is the only statement of
        // where the eraser bites.
        ctx.save();
        ctx.strokeStyle = "rgba(120,120,130,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.offX + ep.x, p.offY + ep.y, ERASER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function loop() {
      const canvas = canvasRef.current;
      if (canvas) {
        if (needPlaceRef.current) place(canvas);
        if (dirtyRef.current) { repaint(canvas); dirtyRef.current = false; }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    needPlaceRef.current = true;
    rafRef.current = requestAnimationFrame(loop);

    // Scrolling does NO painting — it only asks "is the apron still under
    // the viewport?", and only a crossing schedules a re-place.
    const onScroll = () => { if (!covered()) needPlaceRef.current = true; };
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => { needPlaceRef.current = true; });
    ro.observe(sc);
    if (contentEl) ro.observe(contentEl);
    return () => {
      cancelAnimationFrame(rafRef.current);
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scrollEl, contentEl]);

  // Incremental wet-pen rendering, straight from the pointer handler: no
  // clear, no rAF wait — new segments land on the canvas the moment the
  // event arrives, and the canonical redraw on pointerup replaces them.
  // (Highlighters can't join incrementally — 0.35 alpha stacks at every
  // joint — so they take the full-repaint path per frame instead.)
  function wetAppend() {
    const wet = currentStrokeRef.current;
    const canvas = canvasRef.current;
    const p = placeRef.current;
    if (!wet || !canvas || !p.valid) { dirtyRef.current = true; return; }
    const ctx = canvas.getContext("2d", { desynchronized: true });
    if (!ctx) return;
    ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = wet.color;
    ctx.fillStyle = wet.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = wet.pts;
    const n = pts.length / 3;
    if (wetDrawnRef.current === 0 && n >= 1) {
      const r = Math.max((wet.width * (0.5 + pts[2])) / 2, 0.5);
      ctx.beginPath();
      ctx.arc(p.offX + pts[0], p.offY + pts[1], r, 0, Math.PI * 2);
      ctx.fill();
      wetDrawnRef.current = 1;
    }
    for (let i = Math.max(1, wetDrawnRef.current); i < n; i++) {
      const avg = (pts[(i - 1) * 3 + 2] + pts[i * 3 + 2]) / 2;
      ctx.lineWidth = Math.max(wet.width * (0.5 + avg), 0.5);
      ctx.beginPath();
      ctx.moveTo(p.offX + pts[(i - 1) * 3], p.offY + pts[(i - 1) * 3 + 1]);
      ctx.lineTo(p.offX + pts[i * 3], p.offY + pts[i * 3 + 1]);
      ctx.stroke();
    }
    wetDrawnRef.current = n;
  }

  // ── iPad Safari + Apple Pencil: a Pencil drag is also reported as a touch,
  // and by default that touch pans the scroll container, cancelling the
  // pointer-driven stroke mid-draw. Prevent only the stylus touch from
  // scrolling; finger touches are left untouched so they keep scrolling the
  // book. Must be a native non-passive listener — React's touch listeners
  // are passive. (Same trick as PdfViewer.tsx's annotCanvasRef effect.) ──
  useEffect(() => {
    const surface = scrollEl;
    if (!surface) return;
    const onTouchMove = (e: TouchEvent) => {
      // Palm lock: while the pen is committed to a stroke, a resting palm's
      // touches must not pan the page out from under it — writing a margin
      // note would otherwise scroll the book mid-word. Finger scrolling
      // resumes the moment the pen lifts.
      if (isDrawingRef.current || isErasingRef.current) { e.preventDefault(); return; }
      const touches = Array.from(e.touches) as Array<Touch & { touchType?: string }>;
      if (touches.some(t => t.touchType === "stylus")) e.preventDefault();
    };
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => surface.removeEventListener("touchmove", onTouchMove);
  }, [scrollEl]);

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

  // Cmd/Ctrl+Z undoes the last margin op. Ink is always live now, so this is
  // gated on the component being mounted (ParsedViewer fills the pane — no
  // other editor's undo is reachable while a book is open), capture phase so
  // it doesn't leak into global handlers.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Pointer capture — pen-first, on the SCROLL CONTAINER, not the canvas ──
  //
  // ⚠️ The old model made drawing a MODE: the canvas flipped to
  // pointer-events:auto and ate every event — links, text selection, the
  // facit <details> — which is why ink had to hide behind a "Margins"
  // button. The rule the user actually wants (and GoodNotes ships) is
  // per-POINTER, which CSS cannot express: the PEN always draws, TOUCH
  // always navigates, and a pen tap on a paragraph makes a dot rather than
  // following a link — deliberate, that is what the finger is for. So the
  // canvas stays pointer-events:none forever and these listeners live on
  // the scroll container, deciding by pointerType:
  //   pen   → always captured, always draws (any position, any time)
  //   touch → never captured (scrolls; palm-locked while the pen is down)
  //   mouse → draws only in wide-margins mode, so desktop text selection
  //           and link clicks keep working on an ordinary read
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && !enabled) return;
    const surface = scrollEl;
    if (!surface) return;
    e.preventDefault();
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
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
      wetDrawnRef.current = 0;
      if (tool === "highlighter") dirtyRef.current = true; else wetAppend();
      return;
    }
    dirtyRef.current = true;
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    if (isErasingRef.current) {
      if (e.buttons === 0) return;
      e.preventDefault();
      // Sweep every coalesced sample — at Pencil speeds the parent event
      // alone skips whole strokes between 60 Hz frames.
      for (const ev of coalescedOf(e)) {
        eraseAt(toDoc(ev.clientX, ev.clientY));
      }
      erasePosRef.current = toDoc(e.clientX, e.clientY);
      dirtyRef.current = true;
      return;
    }
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    e.preventDefault();
    const pts = currentStrokeRef.current.pts;
    for (const ev of coalescedOf(e)) {
      const pt = toDoc(ev.clientX, ev.clientY);
      penEmaRef.current = emaNext(penEmaRef.current, pressureOf(ev));
      pts.push(pt.x, pt.y, penEmaRef.current);
    }
    if (currentStrokeRef.current.tool === "highlighter") dirtyRef.current = true;
    else wetAppend();
  }

  function onPointerUp(e: PointerEvent) {
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
    wetDrawnRef.current = 0;
    dirtyRef.current = true;
  }

  // Native listeners, re-attached when the closed-over tool/color/enabled
  // change (a render-rate concern only — attaching four listeners is
  // nothing). pointerdown must be non-passive to preventDefault the pen's
  // default gestures; React's synthetic handlers can't sit on the scroll
  // container anyway, ParsedViewer owns that element.
  useEffect(() => {
    const surface = scrollEl;
    if (!surface) return;
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerUp);
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl, enabled, tool, color]);

  // Portaled INTO the scroll container: the canvas must live in the scroll
  // layer for the compositor to move it with the text (see placement above).
  return scrollEl
    ? createPortal(<canvas ref={canvasRef} className="margin-ink-canvas" />, scrollEl)
    : null;
});
