import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
} from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import * as api from "../lib/api";

// Vite ?url import for the PDF.js worker
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// pdfjs-dist v5+ needs three URL params on every getDocument call:
//   - wasmUrl: directory holding jbig2.wasm / openjpeg.wasm / qcms_bg.wasm,
//     used for image decoding. Without it, pages with JBig2 images render blank.
//   - standardFontDataUrl: directory holding the 14 PDF base fonts (.pfb), used
//     when a PDF references a built-in font without embedding it. Without it
//     pdfjs spams "Ensure that the `standardFontDataUrl` API parameter is provided".
//   - useSystemFonts: false — the Tauri webview can't reach the OS font dir,
//     so leaving this on just floods the console with "Cannot load system font".
// All asset directories are copied from node_modules/pdfjs-dist/{wasm,standard_fonts}
// into apps/Vault/Vault/public/pdfjs-{wasm,fonts}/ so they're served at the
// dev/build root.
// Note: these are getDocument() options, NOT GlobalWorkerOptions — setting them
// on the global does nothing.
const PDF_DOC_OPTIONS = {
  wasmUrl: "/pdfjs-wasm/",
  standardFontDataUrl: "/pdfjs-fonts/",
  useSystemFonts: false,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Point { x: number; y: number; } // normalised 0..1 within page

interface Stroke {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number; // base logical px (at zoom 1)
  points: Point[];
}

type Annotations = Record<number, Stroke[]>; // page index → strokes

type Tool = "pen" | "highlighter" | "eraser";

// ─── Constants ───────────────────────────────────────────────────────────────

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3.0;
const DPR = window.devicePixelRatio || 1;
const SAVE_DEBOUNCE_MS = 600;
const ERASER_RADIUS = 0.03; // fraction of page width

const COLORS = [
  "#1a1a1a", "#e74c3c", "#e67e22",
  "#f1c40f", "#27ae60", "#2980b9",
  "#8e44ad", "#ffffff",
];

const STROKE_SIZES: { label: string; value: number }[] = [
  { label: "S", value: 2  },
  { label: "M", value: 4  },
  { label: "L", value: 8  },
  { label: "XL", value: 16 },
];

// ─── PdfPage ─────────────────────────────────────────────────────────────────

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageIdx: number;
  zoom: number;
  strokes: Stroke[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  onStrokeAdded: (pageIdx: number, stroke: Stroke) => void;
  onErase: (pageIdx: number, updatedStrokes: Stroke[]) => void;
}

const PdfPage = memo(function PdfPage({
  doc,
  pageIdx,
  zoom,
  strokes,
  tool,
  color,
  strokeWidth,
  onStrokeAdded,
  onErase,
}: PdfPageProps) {
  const pdfCanvasRef  = useRef<HTMLCanvasElement>(null);
  const annotCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef  = useRef(false);
  const currentPtsRef = useRef<Point[]>([]);
  // keep latest strokes in a ref for eraser (avoids stale closure)
  const strokesRef = useRef<Stroke[]>(strokes);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // ── Draw annotations on the annotation canvas ───────────────────────────
  const redraw = useCallback((canvas: HTMLCanvasElement, stks: Stroke[]) => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stks) {
      if (s.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineCap    = "round";
      ctx.lineJoin   = "round";
      if (s.tool === "highlighter") {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth   = s.width * zoom * DPR * 3;
      } else {
        ctx.lineWidth = s.width * zoom * DPR;
      }
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * canvas.width, s.points[0].y * canvas.height);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * canvas.width, s.points[i].y * canvas.height);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [zoom]);

  // ── Render the PDF page ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let page: PDFPageProxy | null = null;

    async function render() {
      const pdfCanvas  = pdfCanvasRef.current;
      const annotCanvas = annotCanvasRef.current;
      if (!pdfCanvas || !annotCanvas) return;

      page = await doc.getPage(pageIdx + 1);
      if (cancelled) return;

      const viewport = page.getViewport({ scale: zoom * DPR });
      const cssW = viewport.width  / DPR;
      const cssH = viewport.height / DPR;

      pdfCanvas.width  = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.width  = `${cssW}px`;
      pdfCanvas.style.height = `${cssH}px`;

      annotCanvas.width  = viewport.width;
      annotCanvas.height = viewport.height;
      annotCanvas.style.width  = `${cssW}px`;
      annotCanvas.style.height = `${cssH}px`;

      // pdfjs-dist v5+ wants `canvas` directly; `canvasContext` is deprecated
      // and silently no-ops on some pages.
      await page.render({ canvas: pdfCanvas, viewport }).promise;
      if (cancelled) return;

      // Restore any existing annotations after re-render
      redraw(annotCanvas, strokesRef.current);
    }

    render();
    return () => {
      cancelled = true;
      // pdfjs-dist v5+: page.cleanup() returns void, not a Promise.
      try { page?.cleanup(); } catch { /* ignore */ }
    };
  // Intentionally excluding `strokes`/`redraw` — only re-render PDF on doc/zoom change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageIdx, zoom]);

  // ── Re-draw annotations whenever strokes change ──────────────────────────
  useEffect(() => {
    const canvas = annotCanvasRef.current;
    if (canvas && canvas.width > 0) redraw(canvas, strokes);
  }, [strokes, redraw]);

  // ── Pointer helpers ──────────────────────────────────────────────────────
  function normalise(canvas: HTMLCanvasElement, e: React.PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left)  / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  function drawSegment(canvas: HTMLCanvasElement, a: Point, b: Point) {
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    if (tool === "highlighter") {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth   = strokeWidth * zoom * DPR * 3;
    } else {
      ctx.lineWidth = strokeWidth * zoom * DPR;
    }
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  // ── Pointer events ───────────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "eraser") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = normalise(e.currentTarget, e);
    currentPtsRef.current = [pt];
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;

    if (tool === "eraser") {
      if (e.buttons === 0) return;
      const pt = normalise(canvas, e);
      const before = strokesRef.current;
      const after  = before.filter(s =>
        !s.points.some(p => {
          const dx = p.x - pt.x;
          const dy = p.y - pt.y;
          return Math.sqrt(dx * dx + dy * dy) < ERASER_RADIUS;
        })
      );
      if (after.length !== before.length) {
        onErase(pageIdx, after);
        redraw(canvas, after);
      }
      return;
    }

    if (!isDrawingRef.current) return;
    const pts = currentPtsRef.current;
    const pt  = normalise(canvas, e);
    if (pts.length > 0) drawSegment(canvas, pts[pts.length - 1], pt);
    pts.push(pt);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "eraser" || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    const pts = currentPtsRef.current;
    currentPtsRef.current = [];
    if (pts.length < 2) return;

    const stroke: Stroke = {
      id:    Math.random().toString(36).slice(2),
      tool,
      color,
      width: strokeWidth,
      points: pts,
    };
    onStrokeAdded(pageIdx, stroke);
  }

  const cursor = tool === "eraser" ? "cell" : "crosshair";

  return (
    <div className="pdf-page-wrapper">
      <canvas ref={pdfCanvasRef}  className="pdf-page-canvas" />
      <canvas
        ref={annotCanvasRef}
        className="pdf-annot-canvas"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        // Also finish stroke if pointer leaves the canvas
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
});

// ─── PdfViewer ───────────────────────────────────────────────────────────────

interface Props {
  content: string;  // Supabase Storage public URL for the PDF
  nodeId:  string;
}

export function PdfViewer({ content: pdfPath, nodeId }: Props) {
  const [pdfDoc,     setPdfDoc]     = useState<PDFDocumentProxy | null>(null);
  const [numPages,   setNumPages]   = useState(0);
  const [annotations, setAnnotations] = useState<Annotations>({});
  const [tool,       setTool]       = useState<Tool>("pen");
  const [color,      setColor]      = useState("#1a1a1a");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoom,       setZoom]       = useState(1.0);

  const annotationsRef  = useRef<Annotations>({});
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStackRef    = useRef<Array<{ pageIdx: number; strokeId: string }>>([]);
  const scrollRef       = useRef<HTMLDivElement>(null);

  // Keep annotationsRef current
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  // ── Load PDF & annotations ─────────────────────────────────────────────
  useEffect(() => {
    if (!pdfPath) return;

    let task: ReturnType<typeof pdfjs.getDocument> | null = null;

    async function load() {
      try {
        // Load PDF document — pdfPath is now a Supabase Storage public URL
        task = pdfjs.getDocument({ url: pdfPath, ...PDF_DOC_OPTIONS });
        const doc = await task.promise;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PdfViewer] failed to load PDF:", err);
        return;
      }

      // Load saved annotations
      try {
        const raw = await api.readContent(nodeId + "_annot");
        if (raw) {
          const parsed = JSON.parse(raw) as Annotations;
          setAnnotations(parsed);
          annotationsRef.current = parsed;
        }
      } catch {
        // No annotations yet — that's fine
      }
    }

    load();
    return () => { task?.destroy().catch(() => {}); };
  }, [pdfPath, nodeId]);

  // ── Persist annotations (debounced) ───────────────────────────────────
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const scheduleSave = useCallback((next: Annotations) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.saveContent(nodeIdRef.current + "_annot", JSON.stringify(next));
      } catch (err) {
        console.error("Failed to save PDF annotations:", err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // ── Stroke callbacks ──────────────────────────────────────────────────
  const handleStrokeAdded = useCallback((pageIdx: number, stroke: Stroke) => {
    const next = {
      ...annotationsRef.current,
      [pageIdx]: [...(annotationsRef.current[pageIdx] ?? []), stroke],
    };
    setAnnotations(next);
    annotationsRef.current = next;
    undoStackRef.current.push({ pageIdx, strokeId: stroke.id });
    scheduleSave(next);
  }, [scheduleSave]);

  const handleErase = useCallback((pageIdx: number, updated: Stroke[]) => {
    const next = { ...annotationsRef.current, [pageIdx]: updated };
    setAnnotations(next);
    annotationsRef.current = next;
    scheduleSave(next);
  }, [scheduleSave]);

  // ── Undo (Ctrl/Cmd+Z) ─────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const entry = undoStackRef.current.pop();
        if (!entry) return;
        const { pageIdx, strokeId } = entry;
        const next = {
          ...annotationsRef.current,
          [pageIdx]: (annotationsRef.current[pageIdx] ?? []).filter(
            s => s.id !== strokeId
          ),
        };
        setAnnotations(next);
        annotationsRef.current = next;
        scheduleSave(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduleSave]);

  // ── Clear all annotations ─────────────────────────────────────────────
  function clearAll() {
    if (!confirm("Clear all annotations on this PDF?")) return;
    const next: Annotations = {};
    setAnnotations(next);
    annotationsRef.current = next;
    undoStackRef.current = [];
    scheduleSave(next);
  }

  // ── Zoom ──────────────────────────────────────────────────────────────
  function zoomIn()    { setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); }
  function zoomOut()   { setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); }
  function resetZoom() { setZoom(1.0); }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.shiftKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + delta).toFixed(2))));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  if (!pdfPath) {
    return <div className="pdf-empty"><p>PDF not loaded</p></div>;
  }

  return (
    <div className="pdf-viewer">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="pdf-toolbar">

        {/* Zoom */}
        <div className="pdf-toolbar-group">
          <button className="pdf-tb-btn" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out (Shift+Scroll)">−</button>
          <button className="pdf-tb-label" onClick={resetZoom} title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button className="pdf-tb-btn" onClick={zoomIn}  disabled={zoom >= ZOOM_MAX} title="Zoom in (Shift+Scroll)">+</button>
        </div>

        <div className="pdf-tb-sep" />

        {/* Drawing tools */}
        <div className="pdf-toolbar-group">
          {(["pen", "highlighter", "eraser"] as Tool[]).map(t => (
            <button
              key={t}
              className={`pdf-tb-btn pdf-tool-btn ${tool === t ? "active" : ""}`}
              onClick={() => setTool(t)}
              title={t[0].toUpperCase() + t.slice(1)}
            >
              {t === "pen" ? "✏️" : t === "highlighter" ? "🖍" : "⌫"}
            </button>
          ))}
        </div>

        {/* Colors — hidden while eraser active */}
        {tool !== "eraser" && (
          <>
            <div className="pdf-tb-sep" />
            <div className="pdf-toolbar-group">
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`pdf-color-swatch ${color === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </>
        )}

        {/* Stroke sizes — hidden while eraser active */}
        {tool !== "eraser" && (
          <>
            <div className="pdf-tb-sep" />
            <div className="pdf-toolbar-group">
              {STROKE_SIZES.map(({ label, value }) => (
                <button
                  key={value}
                  className={`pdf-tb-btn pdf-size-btn ${strokeWidth === value ? "active" : ""}`}
                  onClick={() => setStrokeWidth(value)}
                  title={`Stroke ${label}`}
                >
                  <span
                    className="pdf-size-dot"
                    style={{ width: Math.min(value * 2, 18), height: Math.min(value * 2, 18) }}
                  />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="pdf-tb-sep" />

        {/* Undo & clear */}
        <div className="pdf-toolbar-group">
          <button
            className="pdf-tb-btn"
            title="Undo last stroke (⌘Z / Ctrl+Z)"
            onClick={() => {
              const entry = undoStackRef.current.pop();
              if (!entry) return;
              const { pageIdx, strokeId } = entry;
              const next = {
                ...annotationsRef.current,
                [pageIdx]: (annotationsRef.current[pageIdx] ?? []).filter(
                  s => s.id !== strokeId
                ),
              };
              setAnnotations(next);
              annotationsRef.current = next;
              scheduleSave(next);
            }}
          >
            ↩
          </button>
          <button className="pdf-tb-btn pdf-clear-btn" title="Clear all annotations" onClick={clearAll}>
            🗑
          </button>
        </div>
      </div>

      {/* ── Pages ───────────────────────────────────────────────────── */}
      <div className="pdf-scroll-area" ref={scrollRef}>
        {pdfDoc && Array.from({ length: numPages }, (_, i) => (
          <PdfPage
            key={i}
            doc={pdfDoc}
            pageIdx={i}
            zoom={zoom}
            strokes={annotations[i] ?? []}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            onStrokeAdded={handleStrokeAdded}
            onErase={handleErase}
          />
        ))}
      </div>
    </div>
  );
}
