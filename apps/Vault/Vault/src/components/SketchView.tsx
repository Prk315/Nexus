// The drawing surface for `sketchBlock`. See extensions/SketchBlock.ts for why
// the strokes live in the document rather than in a row of their own.
//
// Rendered as SVG, not canvas. A canvas would need devicePixelRatio
// bookkeeping, a repaint on every container resize, and its own retained list
// of what has been drawn; SVG needs none of that, stays crisp at any note
// width, and lets React reconcile committed strokes so only the wet one is
// touched during a gesture. CanvasEditor already renders committed ink as SVG
// for the same reason — the canvas there exists only for the live preview,
// where it is redrawing hundreds of strokes over a pannable viewport. A
// sketch has neither problem.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  parseSketch,
  serializeSketch,
  simplify,
  strokeHit,
  strokeOutline,
  outlineToPath,
  SKETCH_MAX_CHARS,
  type SketchData,
  type SketchStroke,
  type SketchTool,
} from "../lib/sketch";
import {
  SKETCH_UNITS,
  SKETCH_MIN_HEIGHT,
  SKETCH_MAX_HEIGHT,
  type SketchBackground,
} from "../extensions/SketchBlock";

const PREFS_KEY = "nexus.vault.sketch.prefs";

const COLORS = ["#111827", "#2563eb", "#16a34a", "#d97706", "#dc2626"];
const PEN_WIDTHS = [1.6, 3, 6];
const HL_WIDTHS = [8, 14, 22];
/** In logical units — generous, because erasing is a gesture, not surgery. */
const ERASER_RADIUS = 14;
/** Minimum gap between wet-stroke repaints. One frame's worth. */
const PAINT_INTERVAL_MS = 16;

interface Prefs {
  tool: SketchTool;
  color: string;
  penWidth: number;
  hlWidth: number;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { tool: "pen", color: COLORS[0], penWidth: 3, hlWidth: 14 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      tool: p.tool === "highlighter" || p.tool === "eraser" ? p.tool : "pen",
      color: typeof p.color === "string" ? p.color : fallback.color,
      penWidth: typeof p.penWidth === "number" ? p.penWidth : fallback.penWidth,
      hlWidth: typeof p.hlWidth === "number" ? p.hlWidth : fallback.hlWidth,
    };
  } catch {
    return fallback;
  }
}

/** Committed strokes. Memoized so a wet-stroke frame doesn't re-render them. */
const Strokes = memo(function Strokes({ strokes }: { strokes: SketchStroke[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <path
          key={i}
          d={outlineToPath(strokeOutline(s))}
          fill={s.c}
          opacity={s.t === "h" ? 0.35 : 1}
          style={s.t === "h" ? { mixBlendMode: "multiply" } : undefined}
        />
      ))}
    </>
  );
});

export function SketchView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const data: SketchData = useMemo(() => parseSketch(node.attrs.data), [node.attrs.data]);
  const height: number = node.attrs.height;
  const background: SketchBackground = node.attrs.background;

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [touchDraw, setTouchDraw] = useState(false);
  const [full, setFull] = useState(false);
  const [wet, setWet] = useState<SketchStroke | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  // The live stroke's points, mutated in place during the gesture. Kept out of
  // React state on purpose: the array grows by a handful of points per frame,
  // and a setState per point would re-render the whole block per point.
  const livePts = useRef<number[]>([]);
  const lastPaintRef = useRef(0);
  const drawingRef = useRef(false);
  const erasedRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const editable = editor.isEditable;
  const width = prefs.tool === "highlighter" ? prefs.hlWidth : prefs.penWidth;

  const savePrefs = useCallback((next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // A full or disabled localStorage must not stop somebody drawing.
    }
  }, []);

  /** Client coords → logical sketch units. */
  const toLocal = useCallback((clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    // BOTH axes divide by r.width. The viewBox preserves aspect, so one unit
    // is the same size vertically as horizontally; dividing y by r.height
    // instead would stretch every stroke whenever the box wasn't square.
    const k = SKETCH_UNITS / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  }, []);

  const commit = useCallback(
    (strokes: SketchStroke[]) => {
      const next = serializeSketch({ v: 1, strokes });
      if (next.length > SKETCH_MAX_CHARS) {
        // Refuse rather than truncate. The whole note shares one 2 MB save
        // budget, so an oversized sketch doesn't fail alone — it stops the
        // note's text saving too.
        setFull(true);
        return false;
      }
      setFull(false);
      updateAttributes({ data: next });
      return true;
    },
    [updateAttributes]
  );

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const kept = dataRef.current.strokes.filter((s) => !strokeHit(s, x, y, ERASER_RADIUS));
      if (kept.length === dataRef.current.strokes.length) return;
      erasedRef.current = true;
      // Update the ref synchronously: a drag erases many strokes across many
      // events, and each one would otherwise re-filter the pre-erase list and
      // resurrect what the previous event removed.
      dataRef.current = { v: 1, strokes: kept };
      commit(kept);
    },
    [commit]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      // A Pencil is unambiguous, and a mouse has no gesture to compete with.
      // A FINGER does: it is also how you scroll the note past this block, so
      // it only draws when the block has been put in touch mode.
      if (e.pointerType === "touch" && !touchDraw) return;
      e.preventDefault();
      e.stopPropagation();

      const p = toLocal(e.clientX, e.clientY);
      if (!p) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimisation — it keeps the stroke following a pointer
        // that leaves the box. It throws for a pointer the browser no longer
        // considers active, and losing the stroke over that would be absurd.
      }

      if (prefs.tool === "eraser") {
        drawingRef.current = true;
        erasedRef.current = false;
        eraseAt(p.x, p.y);
        return;
      }
      drawingRef.current = true;
      livePts.current = [p.x, p.y, e.pressure > 0 ? e.pressure : 0.5];
      setWet({ t: prefs.tool === "highlighter" ? "h" : "p", c: prefs.color, w: width, pts: livePts.current.slice() });
    },
    [editable, touchDraw, toLocal, prefs, width, eraseAt]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();

      if (prefs.tool === "eraser") {
        const p = toLocal(e.clientX, e.clientY);
        if (p) eraseAt(p.x, p.y);
        return;
      }

      // Coalesced events are the difference between a smooth stylus line and a
      // polygon: a Pencil samples far faster than the browser fires pointermove
      // and hands over the skipped samples here. It legitimately returns [] for
      // untrusted (synthetic) events, hence the fallback.
      const native = e.nativeEvent;
      const batch = native.getCoalescedEvents?.() ?? [];
      const events = batch.length ? batch : [native];
      for (const ev of events) {
        const p = toLocal(ev.clientX, ev.clientY);
        if (!p) continue;
        livePts.current.push(p.x, p.y, ev.pressure > 0 ? ev.pressure : 0.5);
      }

      // A timestamp throttle rather than requestAnimationFrame, for the reason
      // BlockHandle.ts spells out: rAF is throttled to nothing in a background
      // tab, so an rAF-gated repaint simply never runs there — which makes the
      // preview impossible to verify with synthetic events. 16 ms is the same
      // budget a frame gives it. Correctness never depended on this anyway:
      // the committed stroke is built from `livePts`, not from what was
      // painted, so a dropped frame costs a frame of preview and nothing else.
      const now = performance.now();
      if (now - lastPaintRef.current < PAINT_INTERVAL_MS) return;
      lastPaintRef.current = now;
      setWet((w) => (w ? { ...w, pts: livePts.current.slice() } : w));
    },
    [prefs.tool, toLocal, eraseAt]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Capture can already be gone if the pointer left the window.
      }
      if (prefs.tool === "eraser") {
        erasedRef.current = false;
        return;
      }

      const pts = livePts.current;
      livePts.current = [];
      setWet(null);
      if (pts.length < 3) return;
      const stroke: SketchStroke = {
        t: prefs.tool === "highlighter" ? "h" : "p",
        c: prefs.color,
        w: width,
        // Simplify once, here. Doing it during the gesture would fight the
        // live preview, and not doing it at all puts thousands of raw stylus
        // samples into the note document.
        pts: simplify(pts),
      };
      commit([...dataRef.current.strokes, stroke]);
    },
    [prefs, width, commit]
  );

  // ── Height resize ─────────────────────────────────────────────────────────
  // Writes to the DOM during the drag and dispatches exactly one transaction on
  // release. A transaction per pointermove would be ~60 document rewrites a
  // second, each waking the 400 ms autosave — the shape of the 2026-08-15
  // incident, and the same rule the column resizer follows.
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const el = surfaceRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      resizeRef.current = { startY: e.clientY, startH: height };
      // No setPointerCapture here. The move/up listeners are on `window`, so
      // they already see a pointer that has left the 10px handle — capture
      // would add nothing and can throw for a pointer the browser no longer
      // considers active, which would abort the drag before those listeners
      // were ever attached.
      const k = SKETCH_UNITS / r.width;

      const move = (ev: PointerEvent) => {
        const st = resizeRef.current;
        if (!st) return;
        const next = clampHeight(st.startH + (ev.clientY - st.startY) * k);
        el.style.aspectRatio = `${SKETCH_UNITS} / ${next}`;
      };
      const up = (ev: PointerEvent) => {
        const st = resizeRef.current;
        resizeRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!st) return;
        el.style.aspectRatio = "";
        updateAttributes({ height: clampHeight(st.startH + (ev.clientY - st.startY) * k) });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [editable, height, updateAttributes]
  );

  const empty = data.strokes.length === 0 && !wet;

  return (
    <NodeViewWrapper className={`sketch-block${selected ? " is-selected" : ""}`}>
      {editable && (
        <div className="sketch-bar" contentEditable={false}>
          <div className="sketch-tools">
            {(["pen", "highlighter", "eraser"] as SketchTool[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`sketch-btn${prefs.tool === t ? " is-active" : ""}`}
                title={t[0].toUpperCase() + t.slice(1)}
                aria-pressed={prefs.tool === t}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => savePrefs({ ...prefs, tool: t })}
              >
                {t === "pen" ? "✎" : t === "highlighter" ? "▬" : "⌫"}
              </button>
            ))}
          </div>

          {prefs.tool !== "eraser" && (
            <>
              <span className="sketch-sep" />
              <div className="sketch-tools">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`sketch-swatch${prefs.color === c ? " is-active" : ""}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={`Colour ${c}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => savePrefs({ ...prefs, color: c })}
                  />
                ))}
              </div>
              <span className="sketch-sep" />
              <div className="sketch-tools">
                {(prefs.tool === "highlighter" ? HL_WIDTHS : PEN_WIDTHS).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`sketch-btn sketch-width${width === w ? " is-active" : ""}`}
                    title={`Width ${w}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      savePrefs(
                        prefs.tool === "highlighter"
                          ? { ...prefs, hlWidth: w }
                          : { ...prefs, penWidth: w }
                      )
                    }
                  >
                    <span style={{ width: Math.max(3, w / 2), height: Math.max(3, w / 2) }} />
                  </button>
                ))}
              </div>
            </>
          )}

          <span className="sketch-spacer" />

          <select
            className="sketch-select"
            value={background}
            aria-label="Background"
            onChange={(e) => updateAttributes({ background: e.target.value })}
          >
            <option value="blank">Blank</option>
            <option value="grid">Grid</option>
            <option value="lines">Lines</option>
          </select>

          <button
            type="button"
            className={`sketch-btn${touchDraw ? " is-active" : ""}`}
            // Off by default: with it on there is no way to scroll the note
            // past the sketch on a touch screen, because every finger drag is
            // a stroke. A Pencil never needs this.
            title={touchDraw ? "Finger draws (tap to scroll instead)" : "Finger scrolls (tap to draw)"}
            aria-pressed={touchDraw}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTouchDraw((v) => !v)}
          >
            ✋
          </button>

          <button
            type="button"
            className="sketch-btn"
            title="Clear sketch"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit([])}
            disabled={empty}
          >
            ✕
          </button>
        </div>
      )}

      <div
        ref={surfaceRef}
        className="sketch-surface"
        data-bg={background}
        style={{
          aspectRatio: `${SKETCH_UNITS} / ${height}`,
          // Only claim the gesture when a finger is actually meant to draw.
          // `touch-action: none` unconditionally would make the note unscrollable
          // wherever a sketch happens to be under your thumb.
          touchAction: touchDraw ? "none" : "pan-y",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          className="sketch-svg"
          viewBox={`0 0 ${SKETCH_UNITS} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <Strokes strokes={data.strokes} />
          {wet && (
            <path
              d={outlineToPath(strokeOutline(wet, false))}
              fill={wet.c}
              opacity={wet.t === "h" ? 0.35 : 1}
            />
          )}
        </svg>

        {empty && editable && <div className="sketch-hint">Draw here</div>}
        {full && (
          <div className="sketch-full" role="status">
            This sketch is full. Clear it, or move the drawing to a Canvas node.
          </div>
        )}
      </div>

      {editable && (
        <div
          className="sketch-resize"
          onPointerDown={onResizeDown}
          title="Drag to resize"
          aria-label="Resize sketch"
        />
      )}
    </NodeViewWrapper>
  );
}

function clampHeight(h: number): number {
  return Math.round(Math.min(Math.max(h, SKETCH_MIN_HEIGHT), SKETCH_MAX_HEIGHT));
}
