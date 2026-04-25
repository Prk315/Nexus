import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  doc: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;      // 0-indexed current visible page
  bookmarks: Set<number>;   // set of bookmarked page indices
  onPageClick: (pageIdx: number) => void;
  onToggleBookmark: (pageIdx: number) => void;
}

type SidebarTab = "pages" | "bookmarks";

// ─── Thumbnail ────────────────────────────────────────────────────────────────

interface ThumbProps {
  doc: PDFDocumentProxy;
  pageIdx: number;
  isActive: boolean;
  onClick: () => void;
}

function PdfThumbnail({ doc, pageIdx, isActive, onClick }: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendered  = useRef(false);

  useEffect(() => {
    if (rendered.current) return;
    let cancelled = false;
    let page: PDFPageProxy | null = null;

    async function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        page = await doc.getPage(pageIdx + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 0.15 });
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width  = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) rendered.current = true;
      } catch {
        // ignore render errors for individual thumbnails
      }
    }

    draw();
    return () => {
      cancelled = true;
      try { page?.cleanup(); } catch { /* ignore */ }
    };
  }, [doc, pageIdx]);

  return (
    <div
      className={`pdf-thumb-item${isActive ? " active" : ""}`}
      onPointerDown={onClick}
    >
      <canvas ref={canvasRef} className="pdf-thumb-canvas" />
      <div className="pdf-thumb-label">{pageIdx + 1}</div>
    </div>
  );
}

// ─── PdfSidebarPanel ─────────────────────────────────────────────────────────

export function PdfSidebarPanel({
  doc,
  numPages,
  currentPage,
  bookmarks,
  onPageClick,
  onToggleBookmark,
}: Props) {
  const [tab, setTab] = useState<SidebarTab>("pages");
  const scrollRef     = useRef<HTMLDivElement>(null);
  const [visibleThumbs, setVisibleThumbs] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const observeRef = useRef<IntersectionObserver | null>(null);

  const setupObserver = useCallback(() => {
    const root = scrollRef.current;
    if (!root || numPages === 0) return;

    observeRef.current?.disconnect();

    const io = new IntersectionObserver(
      (entries) => {
        setVisibleThumbs(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.thumbIdx);
            // Once visible, keep in set — evicting rendered thumbnails buys nothing
            if (entry.isIntersecting) next.add(idx);
          }
          return next;
        });
      },
      { root, rootMargin: "100% 0px" }
    );

    observeRef.current = io;
    const items = root.querySelectorAll<HTMLElement>("[data-thumb-idx]");
    items.forEach(el => io.observe(el));
  }, [numPages]);

  useEffect(() => {
    if (tab !== "pages") return;
    // Small delay to let the DOM render before querying
    const id = setTimeout(setupObserver, 50);
    return () => clearTimeout(id);
  }, [tab, numPages, setupObserver]);

  useEffect(() => {
    return () => { observeRef.current?.disconnect(); };
  }, []);

  const sortedBookmarks = useMemo(
    () => Array.from(bookmarks).sort((a, b) => a - b),
    [bookmarks]
  );

  return (
    <div className="pdf-sidebar-panel">
      {/* Tab bar */}
      <div className="pdf-sidebar-tabs">
        <button
          className={`pdf-sidebar-tab${tab === "pages" ? " active" : ""}`}
          onPointerDown={() => setTab("pages")}
        >
          Pages
        </button>
        <button
          className={`pdf-sidebar-tab${tab === "bookmarks" ? " active" : ""}`}
          onPointerDown={() => setTab("bookmarks")}
        >
          Bookmarks
        </button>
      </div>

      {/* Scrollable content */}
      <div className="pdf-sidebar-scroll" ref={scrollRef}>
        {tab === "pages" && doc &&
          Array.from({ length: numPages }, (_, i) => (
            <div key={i} data-thumb-idx={i}>
              {visibleThumbs.has(i) ? (
                <PdfThumbnail
                  doc={doc}
                  pageIdx={i}
                  isActive={currentPage === i}
                  onClick={() => onPageClick(i)}
                />
              ) : (
                <div className="pdf-thumb-item">
                  <div className="pdf-thumb-placeholder" />
                  <div className="pdf-thumb-label">{i + 1}</div>
                </div>
              )}
            </div>
          ))
        }

        {tab === "pages" && !doc && (
          <div className="pdf-sidebar-empty">Loading…</div>
        )}

        {tab === "bookmarks" && (
          sortedBookmarks.length === 0 ? (
            <div className="pdf-sidebar-empty">No bookmarks yet</div>
          ) : (
            sortedBookmarks.map(pageIdx => (
              <div key={pageIdx} className="pdf-bookmark-item">
                <span className="pdf-bookmark-label">Page {pageIdx + 1}</span>
                <button
                  className="pdf-bookmark-go"
                  onPointerDown={() => onPageClick(pageIdx)}
                  title="Go to page"
                >
                  Go
                </button>
                <button
                  className="pdf-bookmark-del"
                  onPointerDown={() => onToggleBookmark(pageIdx)}
                  title="Remove bookmark"
                >
                  ⨯
                </button>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
