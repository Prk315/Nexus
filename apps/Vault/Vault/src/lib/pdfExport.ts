import { PDFDocument, rgb } from "pdf-lib";
import type { TextAnnotation } from "../components/PdfTextAnnotationLayer";

// ─── Types (mirrored from PdfViewer.tsx) ─────────────────────────────────────

interface Point {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  id: string;
  tool: "pen" | "highlighter" | "eraser" | "line" | "rect" | "ellipse";
  color: string;
  width: number;
  points: Point[];
}

type Annotations = Record<number, Stroke[]>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Build an SVG path from freehand points using Bézier midpoint chaining.
// Coordinates are already in pdf-lib space (bottom-left origin, y-flipped).
function buildSvgPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return "";
  const parts: string[] = [`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    parts.push(`Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`);
  }
  const last = pts[pts.length - 1];
  parts.push(`L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`);
  return parts.join(" ");
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportAnnotatedPdf(
  pdfUrl: string,
  annotations: Annotations,
  textAnnotations: TextAnnotation[],
): Promise<void> {
  const bytes = await fetch(pdfUrl).then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);

  // Group text annotations by page
  const textByPage: Record<number, TextAnnotation[]> = {};
  for (const a of textAnnotations) {
    (textByPage[a.pageIdx] ??= []).push(a);
  }

  // Collect all page indices that need drawing
  const pageIndices = new Set([
    ...Object.keys(annotations).map(Number),
    ...Object.keys(textByPage).map(Number),
  ]);

  for (const pageIdx of pageIndices) {
    const page = pdfDoc.getPage(pageIdx);
    const { width, height } = page.getSize();

    // Convert normalized coords → pdf-lib coords (bottom-left, y-flipped)
    const px = (p: Point) => ({ x: p.x * width, y: height - p.y * height });

    const strokes = annotations[pageIdx] ?? [];
    for (const stroke of strokes) {
      if (stroke.points.length < 1) continue;
      const color = hexToRgb(stroke.color);
      const opacity = stroke.tool === "highlighter" ? 0.4 : 1;

      if (stroke.tool === "line" && stroke.points.length >= 2) {
        const start = px(stroke.points[0]);
        const end   = px(stroke.points[1]);
        page.drawLine({ start, end, thickness: stroke.width, color, opacity });

      } else if (stroke.tool === "rect" && stroke.points.length >= 2) {
        const a = px(stroke.points[0]);
        const b = px(stroke.points[1]);
        page.drawRectangle({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width:  Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          borderWidth: stroke.width,
          borderColor: color,
          opacity,
        });

      } else if (stroke.tool === "ellipse" && stroke.points.length >= 2) {
        const a = px(stroke.points[0]);
        const b = px(stroke.points[1]);
        page.drawEllipse({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          xScale: Math.abs(b.x - a.x) / 2,
          yScale: Math.abs(b.y - a.y) / 2,
          borderWidth: stroke.width,
          borderColor: color,
          opacity,
        });

      } else if (stroke.points.length >= 2) {
        // pen / highlighter — freehand SVG path with y already flipped
        const pts = stroke.points.map(p => ({ x: p.x * width, y: height - p.y * height }));
        const d = buildSvgPath(pts);
        if (d) {
          page.drawSvgPath(d, {
            x: 0,
            y: 0,
            borderColor: color,
            borderWidth: stroke.tool === "highlighter" ? stroke.width * 3 : stroke.width,
            opacity,
          });
        }
      }
    }

    // Text annotations for this page
    for (const annot of textByPage[pageIdx] ?? []) {
      if (!annot.text) continue;
      page.drawText(annot.text, {
        x:     annot.x * width,
        y:     height - annot.y * height,
        size:  annot.fontSize ?? 14,
        color: hexToRgb(annot.color ?? "#1a1a1a"),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href     = url;
  a.download = "annotated.pdf";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
