import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  useMemo,
} from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import * as api from "../lib/api";
import { exportAnnotatedPdf } from "../lib/pdfExport";
import { PdfTextAnnotationLayer } from "./PdfTextAnnotationLayer";
import type { TextAnnotation, TextAnnotations } from "./PdfTextAnnotationLayer";
import { PdfSidebarPanel } from "./PdfSidebarPanel";
import { PdfSearchOverlay } from "./PdfSearchOverlay";

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

interface Point { x: number; y: number; pressure: number; } // normalised 0..1 within page; pressure 0..1 (default 0.5)

interface Stroke {
  id: string;
  tool: "pen" | "highlighter" | "eraser" | "line" | "rect" | "ellipse";
  color: string;
  width: number; // base logical px (at zoom 1)
  points: Point[];
}

type Annotations = Record<number, Stroke[]>; // page index → strokes

type Tool = "pen" | "highlighter" | "eraser" | "text" | "line" | "rect" | "ellipse" | "lasso";

interface LassoRect { x1: number; y1: number; x2: number; y2: number; }

// ─── Lasso geometry helpers ───────────────────────────────────────────────────

function normalizeRect(r: LassoRect): LassoRect {
  return {
    x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2),
    x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2),
  };
}

function pointInRect(p: Point, r: LassoRect): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}

function strokeInRect(s: Stroke, r: LassoRect): boolean {
  return s.points.every(p => pointInRect(p, r));
}

function strokesBoundingBox(stks: Stroke[]): LassoRect | null {
  if (stks.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of stks) {
    for (const p of s.points) {
      if (p.x < x1) x1 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.x > x2) x2 = p.x;
      if (p.y > y2) y2 = p.y;
    }
  }
  return { x1, y1, x2, y2 };
}

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

const SHAPE_TOOLS: Tool[] = ["line", "rect", "ellipse"];

// ─── PdfPage ─────────────────────────────────────────────────────────────────

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageIdx: number;
  renderScale: number; // scale used for canvas rendering — never changes during pinch/zoom
  strokes: Stroke[];
  selectedStrokes: Set<string>;
  tool: Tool;
  color: string;
  strokeWidth: number;
  touchEnabled: boolean; // when false, finger touches scroll (pen-only mode)
  onStrokeAdded: (pageIdx: number, stroke: Stroke) => void;
  onErase: (pageIdx: number, updatedStrokes: Stroke[]) => void;
  onSize: (pageIdx: number, w: number, h: number) => void;
  onLassoSelect: (pageIdx: number, ids: Set<string>) => void;
  onLassoMove: (pageIdx: number, dx: number, dy: number) => void;
  onDeselectLasso: () => void;
}

const PdfPage = memo(function PdfPage({
  doc,
  pageIdx,
  renderScale,
  strokes,
  selectedStrokes,
  tool,
  color,
  strokeWidth,
  touchEnabled,
  onStrokeAdded,
  onErase,
  onSize,
  onLassoSelect,
  onLassoMove,
  onDeselectLasso,
}: PdfPageProps) {
  const pdfCanvasRef  = useRef<HTMLCanvasElement>(null);
  const annotCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef  = useRef(false);
  const currentPtsRef = useRef<Point[]>([]);
  // Bounding rect captured at pointerDown and reused for the entire stroke,
  // so a mid-gesture layout shift (e.g. sidebar opening/closing) doesn't
  // cause a coordinate jump.
  const capturedRectRef = useRef<DOMRect | null>(null);
  // keep latest strokes in a ref for eraser (avoids stale closure)
  const strokesRef = useRef<Stroke[]>(strokes);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // Lasso state — all in refs to avoid re-renders during drag
  const lassoStartRef = useRef<Point | null>(null);
  const lassoRectRef  = useRef<LassoRect | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const dragStartRef = useRef<Point | null>(null);
  const selectedStrokesRef = useRef<Set<string>>(selectedStrokes);
  useEffect(() => { selectedStrokesRef.current = selectedStrokes; }, [selectedStrokes]);

  // ── Draw annotations on the annotation canvas ───────────────────────────
  const redraw = useCallback((canvas: HTMLCanvasElement, stks: Stroke[], selIds?: Set<string>, lassoRect?: LassoRect | null) => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    for (const s of stks) {
      if (s.points.length < 1) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineCap    = "round";
      ctx.lineJoin   = "round";

      if (selIds?.has(s.id)) {
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#4f8ef7";
      }

      if (s.tool === "highlighter") {
        ctx.globalAlpha = 0.35;
      }

      if (s.tool === "line" && s.points.length >= 2) {
        ctx.lineWidth = s.width * renderScale * DPR;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
        ctx.lineTo(s.points[1].x * w, s.points[1].y * h);
        ctx.stroke();
      } else if (s.tool === "rect" && s.points.length >= 2) {
        ctx.lineWidth = s.width * renderScale * DPR;
        const x1 = s.points[0].x * w, y1 = s.points[0].y * h;
        const x2 = s.points[1].x * w, y2 = s.points[1].y * h;
        ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
      } else if (s.tool === "ellipse" && s.points.length >= 2) {
        ctx.lineWidth = s.width * renderScale * DPR;
        const x1 = s.points[0].x * w, y1 = s.points[0].y * h;
        const x2 = s.points[1].x * w, y2 = s.points[1].y * h;
        const cx = (x1+x2)/2, cy = (y1+y2)/2;
        const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.points.length >= 2) {
        // pen / highlighter — quadratic Bézier midpoint chaining for smooth curves
        const spts = s.points;
        const baseWidth = s.tool === "highlighter" ? s.width * renderScale * DPR * 3 : s.width * renderScale * DPR;
        // 0.5 is exactly representable in IEEE 754; equality check is safe
        const hasPressure = spts.some(p => p.pressure !== 0.5);

        if (hasPressure) {
          // Variable-width: one sub-path per segment so lineWidth can vary
          for (let i = 0; i < spts.length - 1; i++) {
            const avgP = (spts[i].pressure + spts[i + 1].pressure) / 2;
            ctx.lineWidth = baseWidth * (0.5 + avgP * 1.5);
            ctx.beginPath();
            if (i === 0) {
              ctx.moveTo(spts[i].x * w, spts[i].y * h);
            } else {
              ctx.moveTo((spts[i - 1].x + spts[i].x) / 2 * w, (spts[i - 1].y + spts[i].y) / 2 * h);
            }
            const mx = (spts[i].x + spts[i + 1].x) / 2 * w;
            const my = (spts[i].y + spts[i + 1].y) / 2 * h;
            ctx.quadraticCurveTo(spts[i].x * w, spts[i].y * h, mx, my);
            ctx.stroke();
          }
        } else {
          // Constant pressure (mouse / old strokes) — single smooth path
          ctx.lineWidth = baseWidth;
          ctx.beginPath();
          ctx.moveTo(spts[0].x * w, spts[0].y * h);
          for (let i = 1; i < spts.length - 1; i++) {
            const mx = (spts[i].x + spts[i + 1].x) / 2 * w;
            const my = (spts[i].y + spts[i + 1].y) / 2 * h;
            ctx.quadraticCurveTo(spts[i].x * w, spts[i].y * h, mx, my);
          }
          ctx.lineTo(spts[spts.length - 1].x * w, spts[spts.length - 1].y * h);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Draw lasso rubber-band
    if (lassoRect) {
      const x1 = lassoRect.x1 * w, y1 = lassoRect.y1 * h;
      const x2 = lassoRect.x2 * w, y2 = lassoRect.y2 * h;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
      ctx.restore();
    }
  }, [renderScale]);

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

      const viewport = page.getViewport({ scale: renderScale * DPR });
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

      // Report rendered size so off-screen placeholders stay the right height
      onSize(pageIdx, cssW, cssH);

      // pdfjs-dist v5+ wants `canvas` directly; `canvasContext` is deprecated
      // and silently no-ops on some pages.
      await page.render({ canvas: pdfCanvas, viewport }).promise;
      if (cancelled) return;

      // Restore any existing annotations after re-render
      redraw(annotCanvas, strokesRef.current, selectedStrokesRef.current, lassoRectRef.current);
    }

    render();
    return () => {
      cancelled = true;
      // pdfjs-dist v5+: page.cleanup() returns void, not a Promise.
      try { page?.cleanup(); } catch { /* ignore */ }
    };
  // Intentionally excluding `strokes`/`redraw` — only re-render PDF on doc/zoom change
  // `onSize` is stable (useCallback with empty deps) so safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageIdx, renderScale, onSize]);

  // ── Re-draw annotations whenever strokes / selection changes ────────────
  useEffect(() => {
    const canvas = annotCanvasRef.current;
    if (canvas && canvas.width > 0) redraw(canvas, strokes, selectedStrokes, lassoRectRef.current);
  }, [strokes, selectedStrokes, redraw]);

  // ── Pointer helpers ──────────────────────────────────────────────────────
  // Use capturedRectRef if a stroke is in progress; otherwise read fresh.
  // This prevents a layout shift mid-stroke (e.g. sidebar animation) from
  // introducing a coordinate jump.
  function normalise(canvas: HTMLCanvasElement, e: React.PointerEvent): Point {
    const r = capturedRectRef.current ?? canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left)  / r.width,
      y: (e.clientY - r.top) / r.height,
      pressure: e.pressure ?? 0.5,
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
      ctx.lineWidth   = strokeWidth * renderScale * DPR * 3;
    } else {
      ctx.lineWidth = strokeWidth * renderScale * DPR;
    }
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  function drawShapePreview(canvas: HTMLCanvasElement, start: Point, end: Point) {
    redraw(canvas, strokesRef.current, selectedStrokesRef.current, null);
    const ctx = canvas.getContext("2d")!;
    const x1 = start.x * canvas.width,  y1 = start.y * canvas.height;
    const x2 = end.x   * canvas.width,  y2 = end.y   * canvas.height;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = strokeWidth * renderScale * DPR;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    if (tool === "line") {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (tool === "rect") {
      ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
    } else if (tool === "ellipse") {
      ctx.beginPath();
      ctx.ellipse((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2, 0, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Pointer events ───────────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!touchEnabled && e.pointerType === "touch" && tool !== "text" && tool !== "lasso") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    capturedRectRef.current = e.currentTarget.getBoundingClientRect();
    const pt = normalise(e.currentTarget, e);
    if (tool === "lasso") {
      const sel = selectedStrokesRef.current;
      if (sel.size > 0) {
        const stks = strokesRef.current.filter(s => sel.has(s.id));
        const bbox = strokesBoundingBox(stks);
        if (bbox && pointInRect(pt, bbox)) { isDraggingSelectionRef.current = true; dragStartRef.current = pt; return; }
        onDeselectLasso();
      }
      lassoStartRef.current = pt; lassoRectRef.current = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }; isDrawingRef.current = true; return;
    }
    if (tool === "eraser" || tool === "text") return;
    isDrawingRef.current = true; currentPtsRef.current = [pt];
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!touchEnabled && e.pointerType === "touch" && tool !== "text" && tool !== "lasso") return;
    const canvas = e.currentTarget;
    if (tool === "lasso") {
      if (isDraggingSelectionRef.current && dragStartRef.current) {
        const pt = normalise(canvas, e);
        const dx = pt.x - dragStartRef.current.x, dy = pt.y - dragStartRef.current.y;
        dragStartRef.current = pt; onLassoMove(pageIdx, dx, dy); return;
      }
      if (!isDrawingRef.current || !lassoStartRef.current) return;
      const pt = normalise(canvas, e);
      lassoRectRef.current = { x1: lassoStartRef.current.x, y1: lassoStartRef.current.y, x2: pt.x, y2: pt.y };
      redraw(canvas, strokesRef.current, selectedStrokesRef.current, lassoRectRef.current); return;
    }
    if (tool === "text") return;
    if (tool === "eraser") {
      if (e.buttons === 0) return;
      const pt = normalise(canvas, e);
      const after = strokesRef.current.filter(s => !s.points.some(p => { const dx = p.x - pt.x, dy = p.y - pt.y; return Math.sqrt(dx*dx+dy*dy) < ERASER_RADIUS; }));
      if (after.length !== strokesRef.current.length) { onErase(pageIdx, after); redraw(canvas, after, selectedStrokesRef.current, null); } return;
    }
    if (!isDrawingRef.current) return;
    const pts = currentPtsRef.current, pt = normalise(canvas, e);
    if (SHAPE_TOOLS.includes(tool)) { if (pts.length > 0) drawShapePreview(canvas, pts[0], pt); return; }
    if (pts.length > 0) drawSegment(canvas, pts[pts.length - 1], pt);
    pts.push(pt);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    if (tool === "lasso") {
      if (isDraggingSelectionRef.current) { isDraggingSelectionRef.current = false; dragStartRef.current = null; capturedRectRef.current = null; return; }
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false; capturedRectRef.current = null;
      const rect = lassoRectRef.current; lassoRectRef.current = null; lassoStartRef.current = null;
      if (!rect) return;
      const nr = normalizeRect(rect);
      const ids = new Set(strokesRef.current.filter(s => strokeInRect(s, nr)).map(s => s.id));
      onLassoSelect(pageIdx, ids); redraw(canvas, strokesRef.current, ids, null); return;
    }
    if (tool === "eraser" || tool === "text" || !isDrawingRef.current) return;
    isDrawingRef.current = false; capturedRectRef.current = null;
    const pts = currentPtsRef.current; currentPtsRef.current = [];
    if (SHAPE_TOOLS.includes(tool)) {
      const pt = normalise(canvas, e), start = pts[0]; if (!start) return;
      onStrokeAdded(pageIdx, { id: Math.random().toString(36).slice(2), tool, color, width: strokeWidth, points: [start, pt] }); return;
    }
    if (pts.length < 2) return;
    onStrokeAdded(pageIdx, { id: Math.random().toString(36).slice(2), tool, color, width: strokeWidth, points: pts });
  }

  const cursor = tool === "eraser" ? "cell" : tool === "text" ? "default" : tool === "lasso" ? (selectedStrokes.size > 0 ? "grab" : "crosshair") : "crosshair";

  return (
    <div className="pdf-page-wrapper">
      <canvas ref={pdfCanvasRef}  className="pdf-page-canvas" />
      <canvas
        ref={annotCanvasRef}
        className="pdf-annot-canvas"
        style={{ cursor, touchAction: touchEnabled ? "none" : "pan-y pinch-zoom" }}
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
  // Keep zoom in a ref so scroll/page-tracker callbacks always see the latest value
  // without being recreated on every zoom change.
  const zoomRef = useRef(1.0);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  // renderScale is the canvas render scale (fit-to-width, recomputed on sidebar toggle).
  // zoom is a pure CSS visual multiplier applied on top — never triggers a canvas re-render.
  const [renderScale, setRenderScale] = useState(1.0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bookmarks, setBookmarks]   = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  // null = indicator display; non-null string = editing mode with that value
  const [pageInputValue, setPageInputValue] = useState<string | null>(null);

  const [textAnnotations, setTextAnnotations] = useState<TextAnnotations>([]);
  const [selectedTextId, setSelectedTextId]   = useState<string | null>(null);
  const [selectedStrokes, setSelectedStrokes] = useState<Set<string>>(new Set());
  const [selectedPage, setSelectedPage]       = useState<number | null>(null);
  const [exporting, setExporting]             = useState(false);
  const [exportError, setExportError]           = useState<string | null>(null);
  // Touch toggle: false = pen-only (fingers scroll), true = touch also draws
  const [touchEnabled, setTouchEnabled]       = useState(false);

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen]           = useState(false);
  const [searchQuery, setSearchQuery]         = useState("");
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const textItemsRef  = useRef<Record<number, TextItem[]>>({});
  const pageViewports = useRef<Record<number, PageViewport>>({});

  const annotationsRef     = useRef<Annotations>({});
  const textAnnotationsRef = useRef<TextAnnotations>([]);
  const saveTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textSaveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookmarkSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportErrorTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportingRef         = useRef(false);
  // Base width of the PDF at scale=1 (populated after first page loads).
  // Used to compute fit-to-width zoom so pages always fill the scroll area.
  const basePdfWidthRef    = useRef<number>(595);
  const undoStackRef       = useRef<Array<{ pageIdx: number; strokeId: string }>>([]);
  const redoStackRef       = useRef<Array<{ pageIdx: number; strokeId: string }>>([]);
  const redoStrokesRef     = useRef<Map<string, Stroke>>(new Map());
  const scrollRef          = useRef<HTMLDivElement>(null);
  // Which pages are currently intersecting the scroll viewport.
  // Off-screen pages render as placeholder divs (no canvases) to cap memory.
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([0, 1, 2]));
  // Estimated per-page CSS size so placeholders keep correct scroll height.
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  // Natural (pre-zoom) total height of all page slots — used to compute the CSS transform margin-bottom.
  const totalHeight = useMemo(() => {
    let h = 0;
    for (let i = 0; i < numPages; i++) h += (pageSizes[i]?.h ?? 0) + 16;
    return h;
  }, [pageSizes, numPages]);

  // Clear export error timer on unmount
  useEffect(() => () => { if (exportErrorTimerRef.current) clearTimeout(exportErrorTimerRef.current); }, []);

  // Keep annotationsRef current
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { textAnnotationsRef.current = textAnnotations; }, [textAnnotations]);

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

        // Compute fit-to-width renderScale so pages fill the scroll area on load.
        try {
          const firstPage = await doc.getPage(1);
          const baseViewport = firstPage.getViewport({ scale: 1.0 });
          basePdfWidthRef.current = baseViewport.width;
          const el = scrollRef.current;
          if (el) {
            const fit = (el.clientWidth - 24) / baseViewport.width;
            setRenderScale(+Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)).toFixed(2));
            setZoom(1.0); // start at 100% of fit-to-width
          }
        } catch { /* best-effort */ }
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

      // Load saved text annotations
      try {
        const rawTxt = await api.readContent(nodeId + "_textannot");
        if (rawTxt) {
          const parsed = JSON.parse(rawTxt) as TextAnnotations;
          setTextAnnotations(parsed);
          textAnnotationsRef.current = parsed;
        }
      } catch {
        // No text annotations yet — that's fine
      }

      // Load saved bookmarks
      try {
        const rawBm = await api.readContent(nodeId + "_bookmarks");
        if (rawBm) {
          const arr = JSON.parse(rawBm) as number[];
          setBookmarks(new Set(arr));
        }
      } catch {
        // No bookmarks yet — that's fine
      }
    }

    load();
    return () => { task?.destroy().catch(() => {}); };
  }, [pdfPath, nodeId]);

  // ── Extract text content for search (runs in parallel after doc loads) ──
  // Runs separately from the annotation-load effect so annotations appear
  // immediately; text extraction is only needed when the user opens search.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    textItemsRef.current = {};
    pageViewports.current = {};

    async function extractPage(i: number) {
      const page = await pdfDoc!.getPage(i + 1);
      if (cancelled) return;
      pageViewports.current[i] = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      if (cancelled) return;
      textItemsRef.current[i] = tc.items.filter((it): it is TextItem => "str" in it);
      try { page.cleanup(); } catch { /* ignore */ }
    }

    const jobs = Array.from({ length: pdfDoc.numPages }, (_, i) => extractPage(i));
    Promise.all(jobs).catch(() => {});

    return () => { cancelled = true; };
  }, [pdfDoc]);

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

  // ── Persist text annotations (debounced) ─────────────────────────────
  const scheduleTextSave = useCallback((next: TextAnnotations) => {
    if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
    textSaveTimerRef.current = setTimeout(async () => {
      try {
        await api.saveContent(nodeIdRef.current + "_textannot", JSON.stringify(next));
      } catch (err) {
        console.error("Failed to save PDF text annotations:", err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // ── Text annotation CRUD ─────────────────────────────────────────────
  const handleTextCreate = useCallback((a: TextAnnotation) => {
    const next = [...textAnnotationsRef.current, a];
    setTextAnnotations(next);
    textAnnotationsRef.current = next;
    setSelectedTextId(a.id);
    scheduleTextSave(next);
  }, [scheduleTextSave]);

  const handleTextChange = useCallback((updated: TextAnnotation) => {
    const next = textAnnotationsRef.current.map(a => a.id === updated.id ? updated : a);
    setTextAnnotations(next);
    textAnnotationsRef.current = next;
    scheduleTextSave(next);
  }, [scheduleTextSave]);

  const handleTextDelete = useCallback((id: string) => {
    const next = textAnnotationsRef.current.filter(a => a.id !== id);
    setTextAnnotations(next);
    textAnnotationsRef.current = next;
    setSelectedTextId(prev => prev === id ? null : prev);
    scheduleTextSave(next);
  }, [scheduleTextSave]);

  // ── Lasso selection handlers ──────────────────────────────────────────
  const selectedStrokesStateRef = useRef<Set<string>>(selectedStrokes);
  useEffect(() => { selectedStrokesStateRef.current = selectedStrokes; }, [selectedStrokes]);

  const handleLassoSelect = useCallback((pageIdx: number, ids: Set<string>) => {
    setSelectedStrokes(ids);
    setSelectedPage(ids.size > 0 ? pageIdx : null);
  }, []);

  const handleLassoMove = useCallback((pageIdx: number, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const sel = selectedStrokesStateRef.current;
    setAnnotations(prev => {
      const strokes = prev[pageIdx];
      if (!strokes) return prev;
      const updated = strokes.map(s =>
        sel.has(s.id)
          ? { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy, pressure: p.pressure ?? 0.5 })) }
          : s
      );
      const next = { ...prev, [pageIdx]: updated };
      annotationsRef.current = next;
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleDeselectLasso = useCallback(() => {
    setSelectedStrokes(new Set());
    setSelectedPage(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedPage === null || selectedStrokes.size === 0) return;
    const pageIdx = selectedPage;
    const pageStrokes = annotationsRef.current[pageIdx] ?? [];
    const removed = pageStrokes.filter(s => selectedStrokes.has(s.id));
    const next = { ...annotationsRef.current, [pageIdx]: pageStrokes.filter(s => !selectedStrokes.has(s.id)) };
    setAnnotations(next); annotationsRef.current = next;
    for (const s of removed) undoStackRef.current.push({ pageIdx, strokeId: s.id });
    redoStackRef.current = []; redoStrokesRef.current.clear();
    setSelectedStrokes(new Set()); setSelectedPage(null);
    scheduleSave(next);
  }, [selectedPage, selectedStrokes, scheduleSave]);

  const applyColorToSelected = useCallback((newColor: string) => {
    if (selectedPage === null || selectedStrokes.size === 0) return;
    setAnnotations(prev => {
      const updated = (prev[selectedPage] ?? []).map(s =>
        selectedStrokes.has(s.id) ? { ...s, color: newColor } : s
      );
      const next = { ...prev, [selectedPage]: updated };
      annotationsRef.current = next;
      scheduleSave(next);
      return next;
    });
  }, [selectedPage, selectedStrokes, scheduleSave]);

  const duplicateSelected = useCallback(() => {
    if (selectedPage === null || selectedStrokes.size === 0) return;
    setAnnotations(prev => {
      const pageStrokes = prev[selectedPage] ?? [];
      const clones = pageStrokes
        .filter(s => selectedStrokes.has(s.id))
        .map(s => ({
          ...s,
          id: Math.random().toString(36).slice(2),
          points: s.points.map(p => ({ ...p, x: p.x + 0.02, y: p.y + 0.02 })),
        }));
      const next = { ...prev, [selectedPage]: [...pageStrokes, ...clones] };
      annotationsRef.current = next;
      scheduleSave(next);
      for (const c of clones) undoStackRef.current.push({ pageIdx: selectedPage, strokeId: c.id });
      redoStackRef.current = []; redoStrokesRef.current.clear();
      setSelectedStrokes(new Set(clones.map(c => c.id)));
      return next;
    });
  }, [selectedPage, selectedStrokes, scheduleSave]);

  // ── Bookmarks ─────────────────────────────────────────────────────────
  const scheduleBookmarkSave = useCallback((next: Set<number>) => {
    if (bookmarkSaveTimerRef.current) clearTimeout(bookmarkSaveTimerRef.current);
    bookmarkSaveTimerRef.current = setTimeout(async () => {
      try {
        await api.saveContent(nodeIdRef.current + "_bookmarks", JSON.stringify([...next]));
      } catch (err) {
        console.error("Failed to save PDF bookmarks:", err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const toggleBookmark = useCallback((pageIdx: number) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(pageIdx)) {
        next.delete(pageIdx);
      } else {
        next.add(pageIdx);
      }
      scheduleBookmarkSave(next);
      return next;
    });
  }, [scheduleBookmarkSave]);

  // ── Export annotated PDF ──────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!pdfPath || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    try {
      await exportAnnotatedPdf(pdfPath, annotationsRef.current, textAnnotationsRef.current);
    } catch {
      setExportError("Export failed");
      if (exportErrorTimerRef.current) clearTimeout(exportErrorTimerRef.current);
      exportErrorTimerRef.current = setTimeout(() => setExportError(null), 3000);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [pdfPath]);

  // ── Scroll to page ────────────────────────────────────────────────────
  const scrollToPage = useCallback((pageIdx: number) => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-page-idx="${pageIdx}"]`);
    if (el) {
      // el.offsetTop is the un-zoomed layout position (includes 20px scroll-area padding).
      // With transform: scale(zoom) origin at top-center, the visual position scales too.
      const z = zoomRef.current;
      root.scrollTop = (el.offsetTop - 20) * z;
    }
  }, []);

  // ── Track current page via scroll ─────────────────────────────────────
  // Keep pageSizes in a ref so the scroll handler reads the latest value
  // without being recreated every time a page finishes rendering.
  const pageSizesRef = useRef<Record<number, { w: number; h: number }>>({});
  useEffect(() => { pageSizesRef.current = pageSizes; }, [pageSizes]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || numPages === 0) return;
    // Capture as non-nullable so the closure doesn't need a null-check on each scroll.
    const el = root;

    function onScroll() {
      const scrollTop = el.scrollTop;
      const sizes = pageSizesRef.current;
      const z = zoomRef.current;
      let bestIdx = 0;
      let bestDist = Infinity;
      // If all page sizes are known, walk cumulative heights without touching DOM.
      // cumH is the un-zoomed layout offset; multiply by z for the visual scroll position.
      if (Object.keys(sizes).length === numPages) {
        let cumH = 0;
        for (let i = 0; i < numPages; i++) {
          const dist = Math.abs(cumH * z - scrollTop);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          cumH += (sizes[i]?.h ?? 0) + 16; // 16px = .pdf-page-slot margin-bottom
        }
      } else {
        // Fallback: DOM query before first render pass populates pageSizes.
        for (let i = 0; i < numPages; i++) {
          const slot = el.querySelector<HTMLElement>(`[data-page-idx="${i}"]`);
          if (!slot) continue;
          const dist = Math.abs((slot.offsetTop - 20) * z - scrollTop);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
      }
      setCurrentPage(prev => prev === bestIdx ? prev : bestIdx);
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [numPages]);

  // ── Stroke callbacks ──────────────────────────────────────────────────
  const handleStrokeAdded = useCallback((pageIdx: number, stroke: Stroke) => {
    const next = {
      ...annotationsRef.current,
      [pageIdx]: [...(annotationsRef.current[pageIdx] ?? []), stroke],
    };
    setAnnotations(next);
    annotationsRef.current = next;
    undoStackRef.current.push({ pageIdx, strokeId: stroke.id });
    // Any new stroke invalidates redo history
    redoStackRef.current = [];
    redoStrokesRef.current.clear();
    scheduleSave(next);
  }, [scheduleSave]);

  const handleErase = useCallback((pageIdx: number, updated: Stroke[]) => {
    const next = { ...annotationsRef.current, [pageIdx]: updated };
    setAnnotations(next);
    annotationsRef.current = next;
    scheduleSave(next);
  }, [scheduleSave]);

  // ── Undo / Redo shared helpers ────────────────────────────────────────
  const handleUndoBtn = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const { pageIdx, strokeId } = entry;
    const pageStrokes = annotationsRef.current[pageIdx] ?? [];
    const removed = pageStrokes.find(s => s.id === strokeId);
    const next = { ...annotationsRef.current, [pageIdx]: pageStrokes.filter(s => s.id !== strokeId) };
    setAnnotations(next); annotationsRef.current = next;
    if (removed) { redoStackRef.current.push({ pageIdx, strokeId }); redoStrokesRef.current.set(strokeId, removed); }
    scheduleSave(next);
  }, [scheduleSave]);

  const handleRedoBtn = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    const { pageIdx, strokeId } = entry;
    const stroke = redoStrokesRef.current.get(strokeId);
    if (!stroke) return;
    redoStrokesRef.current.delete(strokeId);
    const next = { ...annotationsRef.current, [pageIdx]: [...(annotationsRef.current[pageIdx] ?? []), stroke] };
    setAnnotations(next); annotationsRef.current = next;
    undoStackRef.current.push({ pageIdx, strokeId });
    scheduleSave(next);
  }, [scheduleSave]);

  // ── Keyboard shortcuts: Undo / Redo / Lasso Delete ────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndoBtn(); return; }
      if (mod && e.key === "z" && e.shiftKey)  { e.preventDefault(); handleRedoBtn(); return; }
      if (mod && e.key === "f") { e.preventDefault(); setSearchOpen(true); return; }
      if (e.key === "Escape" && searchOpen) { setSearchOpen(false); return; }

      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndoBtn, handleRedoBtn, deleteSelected, searchOpen]);

  // ── Clear all annotations ─────────────────────────────────────────────
  // Uses inline confirmation state — window.confirm() is suppressed in
  // Tauri's WKWebView (iOS) and would silently no-op, so we avoid it.
  function clearAll() {
    const next: Annotations = {};
    setAnnotations(next);
    annotationsRef.current = next;
    undoStackRef.current = [];
    redoStackRef.current = [];
    redoStrokesRef.current.clear();
    scheduleSave(next);
    setConfirmClear(false);
  }

  // ── Zoom ──────────────────────────────────────────────────────────────
  function zoomIn()    { setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); }
  function zoomOut()   { setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); }
  function resetZoom() { setZoom(1.0); } // 100% = fit-to-width

  // When the sidebar opens/closes the scroll area width changes — recompute
  // renderScale after the DOM settles. zoom stays at whatever the user set.
  useEffect(() => {
    if (!pdfDoc) return;
    const timer = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || basePdfWidthRef.current === 0) return;
      const fit = (el.clientWidth - 24) / basePdfWidthRef.current;
      setRenderScale(+Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)).toFixed(2));
    }, 50);
    return () => clearTimeout(timer);
  }, [sidebarOpen, pdfDoc]);

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

  // ── Pinch-to-zoom (two-finger touch) ─────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastDist = 0;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        lastDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || lastDist === 0) return;
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const rawRatio = dist / lastDist;
      lastDist = dist;

      // Skip micro-movements — also lets two-finger pan fall through to native scroll
      if (Math.abs(rawRatio - 1) < 0.004) return;

      // Real pinch detected — prevent native scroll/zoom and handle ourselves
      e.preventDefault();

      // Dampen: pull ratio toward 1 so zoom is slower and smoother
      const ratio = 1 + (rawRatio - 1) * 0.55;

      // Pinch midpoint Y relative to the scroll area's visible top
      const midY = (t0.clientY + t1.clientY) / 2;
      const rect = el.getBoundingClientRect();
      const viewY = midY - rect.top;

      const z = zoomRef.current;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * ratio).toFixed(3)));
      if (newZoom === z) return;

      // Keep the canvas point under the pinch midpoint fixed.
      // With transformOrigin "top center", docY = (scrollTop + viewY) / z,
      // so after zoom: newScrollTop = docY * newZoom - viewY
      el.scrollTop = Math.max(0, (el.scrollTop + viewY) * (newZoom / z) - viewY);
      setZoom(newZoom);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  function commitPageInput() {
    const val = parseInt(pageInputValue ?? "", 10);
    if (!isNaN(val)) scrollToPage(Math.max(0, Math.min(numPages - 1, val - 1)));
    setPageInputValue(null);
  }

  // ── Virtual rendering: observe page wrappers, only mount canvases for
  //    pages near the viewport. Keeps memory bounded regardless of PDF length.
  //    rootMargin: render 1 full viewport ahead/behind so scrolling is smooth.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || numPages === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        setVisiblePages(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIdx);
            if (entry.isIntersecting) {
              next.add(idx);
            } else {
              // Keep one page buffer on each side so scroll feels instant
              const anyNeighbourVisible = next.has(idx - 1) || next.has(idx + 1);
              if (!anyNeighbourVisible) next.delete(idx);
            }
          }
          return next;
        });
      },
      { root, rootMargin: "200% 0px" }
    );

    // Observe all page wrapper elements (they render even when off-screen)
    const wrappers = root.querySelectorAll<HTMLElement>("[data-page-idx]");
    wrappers.forEach(el => io.observe(el));

    return () => io.disconnect();
  // Re-run when numPages or renderScale changes (renderScale changes page heights)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, renderScale]);

  // Track rendered page sizes so placeholder divs hold the right height.
  const handlePageSize = useCallback((pageIdx: number, w: number, h: number) => {
    setPageSizes(prev => {
      if (prev[pageIdx]?.w === w && prev[pageIdx]?.h === h) return prev;
      return { ...prev, [pageIdx]: { w, h } };
    });
  }, []);

  // Estimate placeholder size for pages we haven't rendered yet (use last known
  // or fall back to a rough A4 estimate based on zoom).
  const estimatedPageSize = useMemo(() => {
    const known = Object.values(pageSizes);
    if (known.length > 0) {
      const avgW = known.reduce((s, p) => s + p.w, 0) / known.length;
      const avgH = known.reduce((s, p) => s + p.h, 0) / known.length;
      return { w: avgW, h: avgH };
    }
    // A4 at 96dpi × renderScale (CSS px)
    return { w: Math.round(595 * renderScale), h: Math.round(842 * renderScale) };
  }, [pageSizes, renderScale]);

  // Group text annotations by page index to avoid O(N×M) filter inside the render loop.
  const textAnnotsByPage = useMemo(() => {
    const map: Record<number, TextAnnotation[]> = {};
    for (const a of textAnnotations) {
      (map[a.pageIdx] ??= []).push(a);
    }
    return map;
  }, [textAnnotations]);

  // ── Search: scan all pages for query matches ───────────────────────────
  const matches = useMemo<{ pageIdx: number; itemIdx: number }[]>(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const result: { pageIdx: number; itemIdx: number }[] = [];
    const pages = textItemsRef.current;
    for (const pageIdxStr of Object.keys(pages)) {
      const pageIdx = Number(pageIdxStr);
      const items = pages[pageIdx];
      for (let i = 0; i < items.length; i++) {
        if (items[i].str.toLowerCase().includes(q)) {
          result.push({ pageIdx, itemIdx: i });
        }
      }
    }
    return result;
  // searchQuery changes drive recompute; textItemsRef is stable after load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function prevMatch() {
    if (matches.length === 0) return;
    const idx = (currentMatchIdx - 1 + matches.length) % matches.length;
    setCurrentMatchIdx(idx);
    scrollToPage(matches[idx].pageIdx);
  }

  function nextMatch() {
    if (matches.length === 0) return;
    const idx = (currentMatchIdx + 1) % matches.length;
    setCurrentMatchIdx(idx);
    scrollToPage(matches[idx].pageIdx);
  }

  // Scroll to current match when search panel opens or the active match changes.
  useEffect(() => {
    if (searchOpen && matches.length > 0) {
      scrollToPage(matches[Math.min(currentMatchIdx, matches.length - 1)].pageIdx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, currentMatchIdx]);

  // ── Render ────────────────────────────────────────────────────────────
  if (!pdfPath) {
    return <div className="pdf-empty"><p>PDF not loaded</p></div>;
  }

  return (
    <div className="pdf-viewer">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="pdf-toolbar">

        {/* Sidebar toggle */}
        <div className="pdf-toolbar-group">
          <button
            className={`pdf-tb-btn${sidebarOpen ? " active" : ""}`}
            onClick={() => setSidebarOpen(o => !o)}
            title="Toggle sidebar (thumbnails & bookmarks)"
          >
            ◧
          </button>
        </div>

        <div className="pdf-tb-sep" />

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
          {/* Text tool */}
          <button
            className={`pdf-tb-btn pdf-tool-btn ${tool === "text" ? "active" : ""}`}
            onClick={() => setTool("text")}
            title="Text annotation (double-click page to add)"
            style={{ fontWeight: 700, fontStyle: "italic", fontSize: 14 }}
          >
            T
          </button>
        </div>

        <div className="pdf-tb-sep" />

        {/* Shape tools */}
        <div className="pdf-toolbar-group">
          {([
            { t: "line" as Tool, label: "—", title: "Line" },
            { t: "rect" as Tool, label: "▭", title: "Rectangle" },
            { t: "ellipse" as Tool, label: "◯", title: "Ellipse" },
          ]).map(({ t, label, title }) => (
            <button
              key={t}
              className={`pdf-tb-btn pdf-tool-btn ${tool === t ? "active" : ""}`}
              onClick={() => setTool(t)}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pdf-tb-sep" />

        {/* Lasso select */}
        <div className="pdf-toolbar-group">
          <button
            className={`pdf-tb-btn pdf-tool-btn ${tool === "lasso" ? "active" : ""}`}
            onClick={() => setTool("lasso")}
            title="Lasso select (drag to select, Delete to remove, drag selection to move)"
          >
            ⬚
          </button>
        </div>

        {/* Colors — hidden while eraser/lasso/text active */}
        {tool !== "eraser" && tool !== "text" && tool !== "lasso" && (
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

        {/* Stroke sizes — hidden while eraser/lasso/text tool active */}
        {tool !== "eraser" && tool !== "text" && tool !== "lasso" && (
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

        {/* Undo / Redo / Clear */}
        <div className="pdf-toolbar-group">
          <button className="pdf-tb-btn" title="Undo last stroke (⌘Z / Ctrl+Z)" onClick={handleUndoBtn}>↩</button>
          <button className="pdf-tb-btn" title="Redo (⌘⇧Z / Ctrl+Shift+Z)" onClick={handleRedoBtn}>↪</button>
          {confirmClear ? (
            <>
              <span className="pdf-tb-confirm-label">Clear all?</span>
              <button className="pdf-tb-btn pdf-clear-confirm-btn" title="Confirm clear" onClick={clearAll}>✓</button>
              <button className="pdf-tb-btn" title="Cancel" onClick={() => setConfirmClear(false)}>✕</button>
            </>
          ) : (
            <button className="pdf-tb-btn pdf-clear-btn" title="Clear all annotations" onClick={() => setConfirmClear(true)}>
              🗑
            </button>
          )}
        </div>

        <div className="pdf-tb-sep" />

        {/* Bookmark current page */}
        <div className="pdf-toolbar-group">
          <button
            className={`pdf-tb-btn${bookmarks.has(currentPage) ? " active" : ""}`}
            onClick={() => toggleBookmark(currentPage)}
            title={bookmarks.has(currentPage) ? "Remove bookmark" : "Bookmark this page"}
          >
            ★
          </button>
        </div>

        {numPages > 0 && (
          <>
            <div className="pdf-tb-sep" />
            <div className="pdf-toolbar-group">
              {pageInputValue !== null ? (
                <input
                  className="pdf-page-indicator-input"
                  type="number"
                  min={1}
                  max={numPages}
                  value={pageInputValue}
                  autoFocus
                  onChange={e => setPageInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") commitPageInput();
                    if (e.key === "Escape") setPageInputValue(null);
                  }}
                  onBlur={commitPageInput}
                />
              ) : (
                <button
                  className="pdf-page-indicator"
                  title="Click to jump to page"
                  onClick={() => setPageInputValue(String(currentPage + 1))}
                >
                  {currentPage + 1} / {numPages}
                </button>
              )}
            </div>
          </>
        )}

        <div className="pdf-tb-sep" />

        {/* Search */}
        <div className="pdf-toolbar-group">
          <button className="pdf-tb-btn" title="Search (⌘F)" onClick={() => setSearchOpen(s => !s)}>🔍</button>
          {searchOpen && (
            <>
              <input
                className="pdf-search-input"
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentMatchIdx(0); }}
                autoFocus
              />
              {searchQuery && (
                <span className="pdf-tb-label">
                  {matches.length === 0 ? "No results" : `${currentMatchIdx + 1} / ${matches.length}`}
                </span>
              )}
              {matches.length > 0 && (
                <>
                  <button className="pdf-tb-btn" onClick={prevMatch} title="Previous">◀</button>
                  <button className="pdf-tb-btn" onClick={nextMatch} title="Next">▶</button>
                </>
              )}
            </>
          )}
        </div>

        <div className="pdf-tb-sep" />

        {/* Touch toggle — pen-only vs touch+pen input */}
        <div className="pdf-toolbar-group">
          <button
            className={`pdf-tb-btn${touchEnabled ? " active" : ""}`}
            onClick={() => setTouchEnabled(t => !t)}
            title={touchEnabled ? "Touch ON — finger draws (tap to disable)" : "Touch OFF — finger scrolls only (tap to enable)"}
          >
            ☝
          </button>
        </div>

        <div className="pdf-tb-sep" />

        {/* Export PDF */}
        <div className="pdf-toolbar-group">
          {exportError && <span className="pdf-export-error">{exportError}</span>}
          <button
            className="pdf-tb-btn"
            onClick={handleExport}
            disabled={exporting || !pdfPath}
            title="Export PDF with annotations"
          >
            {exporting ? "…" : "↓ PDF"}
          </button>
        </div>
      </div>

      {/* ── Lasso action bar ─────────────────────────────────────────── */}
      {selectedStrokes.size > 0 && selectedPage !== null && (
        <div className="pdf-lasso-action-bar">
          <span className="pdf-tb-label">Selection:</span>
          {COLORS.map(c => (
            <button
              key={c}
              className="pdf-color-swatch"
              style={{ background: c }}
              onClick={() => applyColorToSelected(c)}
              title={`Recolor to ${c}`}
            />
          ))}
          <div className="pdf-tb-sep" />
          <button className="pdf-tb-btn" onClick={duplicateSelected} title="Duplicate selection">⧉ Dup</button>
          <button className="pdf-tb-btn pdf-clear-btn" onClick={deleteSelected} title="Delete selection">🗑 Del</button>
        </div>
      )}

      {/* ── Body: sidebar + scroll area ──────────────────────────────── */}
      <div className="pdf-viewer-body">
        {sidebarOpen && (
          <PdfSidebarPanel
            doc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            bookmarks={bookmarks}
            onPageClick={scrollToPage}
            onToggleBookmark={toggleBookmark}
          />
        )}
        <div className="pdf-main-content">
          {/* ── Pages + scrubber ──────────────────────────────────────── */}
          <div className="pdf-scroll-wrapper">
            <div className="pdf-scroll-area" ref={scrollRef}>
              {/* transform: scale() applies visual magnification without re-rendering canvases.
                  Unlike CSS zoom, getBoundingClientRect() returns post-transform values in
                  WebKit/WKWebView, so pointer-event normalisation (clientX - rect.left) / rect.width
                  stays correct at every zoom level. marginBottom compensates for the layout space
                  that transform does not expand, so the scroll area height reflects the visual size. */}
              <div style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
                marginBottom: `${(zoom - 1) * totalHeight}px`,
              }}>
              {pdfDoc && Array.from({ length: numPages }, (_, i) => {
                const size = pageSizes[i] ?? estimatedPageSize;
                const pageAnnots = textAnnotsByPage[i] ?? [];
                return (
                  // data-page-idx is observed by IntersectionObserver above
                  <div key={i} data-page-idx={i} className="pdf-page-slot">
                    {visiblePages.has(i) ? (
                      <div className="pdf-page-with-text">
                        <PdfPage
                          doc={pdfDoc}
                          pageIdx={i}
                          renderScale={renderScale}
                          strokes={annotations[i] ?? []}
                          selectedStrokes={selectedPage === i ? selectedStrokes : new Set<string>()}
                          tool={tool}
                          color={color}
                          strokeWidth={strokeWidth}
                          touchEnabled={touchEnabled}
                          onStrokeAdded={handleStrokeAdded}
                          onErase={handleErase}
                          onSize={handlePageSize}
                          onLassoSelect={handleLassoSelect}
                          onLassoMove={handleLassoMove}
                          onDeselectLasso={handleDeselectLasso}
                        />
                        <PdfTextAnnotationLayer
                          pageIdx={i}
                          annotations={pageAnnots}
                          pageWidth={size.w}
                          pageHeight={size.h}
                          zoom={zoom}
                          tool={tool}
                          selectedId={selectedTextId}
                          onSelect={setSelectedTextId}
                          onChange={handleTextChange}
                          onCreate={handleTextCreate}
                          onDelete={handleTextDelete}
                        />
                        {searchOpen && searchQuery && textItemsRef.current[i] && pageViewports.current[i] && (
                          <PdfSearchOverlay
                            pageIdx={i}
                            matches={matches}
                            currentMatchIdx={currentMatchIdx}
                            textItems={textItemsRef.current[i]}
                            viewport={pageViewports.current[i].clone({ scale: renderScale })}
                          />
                        )}
                      </div>
                    ) : (
                      // Placeholder keeps scroll height correct while canvases are unmounted
                      <div
                        className="pdf-page-placeholder"
                        style={{ width: size.w, height: size.h }}
                      />
                    )}
                  </div>
                );
              })}
              </div>{/* end css-zoom wrapper */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
