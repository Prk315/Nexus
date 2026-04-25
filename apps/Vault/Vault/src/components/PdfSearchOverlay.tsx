import * as pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PdfSearchOverlayProps {
  pageIdx: number;
  matches: { pageIdx: number; itemIdx: number }[];
  currentMatchIdx: number;
  textItems: TextItem[];
  viewport: PageViewport;
}

// ─── PdfSearchOverlay ─────────────────────────────────────────────────────────

export function PdfSearchOverlay({
  pageIdx,
  matches,
  currentMatchIdx,
  textItems,
  viewport,
}: PdfSearchOverlayProps) {
  const pageMatches = matches
    .map((m, globalIdx) => ({ ...m, globalIdx }))
    .filter(m => m.pageIdx === pageIdx);

  if (pageMatches.length === 0) return null;

  return (
    <div className="pdf-search-overlay">
      {pageMatches.map(({ itemIdx, globalIdx }) => {
        const item = textItems[itemIdx];
        if (!item) return null;

        // Convert PDF user-space coords to CSS pixel space via the viewport transform.
        // item.transform is [a, b, c, d, e, f] where e=x, f=y in PDF user-space.
        const [x, y] = pdfjs.Util.transform(
          viewport.transform,
          [1, 0, 0, 1, item.transform[4], item.transform[5]]
        );

        const width = item.width * viewport.scale;
        // Use item height if available, otherwise fall back to a sensible line height.
        const height = item.height > 0 ? item.height * viewport.scale : 14 * viewport.scale;

        const isCurrent = globalIdx === currentMatchIdx;

        return (
          <div
            key={`${pageIdx}-${itemIdx}-${globalIdx}`}
            className={`pdf-search-highlight${isCurrent ? " current" : ""}`}
            style={{
              left: x,
              top: y - height, // PDF origin is bottom-left; CSS is top-left
              width: Math.max(width, 4),
              height: Math.max(height, 8),
            }}
          />
        );
      })}
    </div>
  );
}
