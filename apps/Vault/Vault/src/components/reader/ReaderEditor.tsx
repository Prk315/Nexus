// Composes the four reader components and owns everything they share.
//
// Spec §7: ReaderPages, ConceptRail, OutlineColumn and ToggleRails talk to each
// other through `{ pages, currentPage, visibleBlocks, onNavigate }` and the
// toggle state, and through nothing else. That holds here literally — no
// context, no ref passed sideways, no child measuring a sibling.
//
// The one thing that made that awkward is scroll position: something has to
// know which page is on screen, and the obvious way is an IntersectionObserver
// over elements ReaderPages renders, which means ReaderPages handing its DOM to
// its parent. It does not, because it does not have to: page heights are a pure
// function of the column width (readerTypes.pageBoxHeight), so this component
// works out the page and the visible blocks from `scrollTop` and arithmetic.
// The column width is decided HERE and handed down, so there is exactly one
// number in the reader that anything is measured from.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConceptRail } from "./ConceptRail";
import { OutlineColumn } from "./OutlineColumn";
import { ReaderPages } from "./ReaderPages";
import { ToggleRails } from "./ToggleRails";
import { loadReaderDoc } from "./loadReader";
import type { ReaderBlock, ReaderDoc, ReaderToggles, ReaderView } from "./readerTypes";
import {
  PAGE_GAP, PAGE_PAD, blockFrac, pageAtOffset, pageBoxHeight, pageTop,
} from "./readerTypes";
import "./reader.css";

/**
 * Scroll the reader to an offset, clamped, and animated unless the reader has
 * asked for less motion.
 *
 * Chrome does NOT derive `behavior: "smooth"` from prefers-reduced-motion — it
 * animates regardless — so a reader who asked for stillness gets a 2500px
 * glide across ten pages every time they click a concept. Asking the media
 * query here is the only thing that honours it; the CSS `scroll-behavior`
 * property has the same gap.
 *
 * Clamping matters for the last page: a block near the foot of p.253 asks for
 * an offset past the end, and an unclamped scrollTo leaves the position one
 * frame away from where the flash is drawn.
 */
function scrollReaderTo(el: HTMLElement, to: number): void {
  const target = Math.max(0, Math.min(to, el.scrollHeight - el.clientHeight));
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollTo({ top: target, behavior: reduce ? "auto" : "smooth" });
}

/** The merged column: concept rail, with the outline as a layer over it. */
const ASIDE_WIDTH = 190;
/** The toggle rail between that column and the page. */
const COLRAIL_WIDTH = 13;

/** What the column is worth at zoom 1, before the window is measured. */
const MIN_FIT_WIDTH = 360;
const MAX_FIT_WIDTH = 900;
/* Zoom is allowed to take the page well past the window — that is the point of
 * zooming a book — so the absolute ceiling is much larger than the fit width
 * and the scroller takes the overflow. */
const MIN_PAGE_WIDTH = 280;
const MAX_PAGE_WIDTH = 2600;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The rendered page width for a fit width and a zoom. The only place the two meet. */
function columnWidthFor(fitWidth: number, zoom: number): number {
  return Math.round(clamp(fitWidth * zoom, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH));
}

interface Props {
  /** The node's stored content: a pointer, or the reader JSON itself. */
  content: string;
  nodeId: string;
}

export function ReaderEditor({ content, nodeId }: Props) {
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [toggles, setToggles] = useState<ReaderToggles>({ column: true, dataLayer: false });
  const [currentPage, setCurrentPage] = useState(0);
  const [visibleBlocks, setVisibleBlocks] = useState<string[]>([]);
  const [highlightBlock, setHighlightBlock] = useState<string | null>(null);
  const [fitWidth, setFitWidth] = useState(MIN_FIT_WIDTH);
  const [zoom, setZoom] = useState(1);
  // The outline is a layer over the rail, raised by pointer or focus rather
  // than by a toggle — see the merged column below.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const columnWidth = columnWidthFor(fitWidth, zoom);
  const [copied, setCopied] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  /** Scroll offset to restore once a zoom has re-rendered at the new width. */
  const pendingScrollRef = useRef<number | null>(null);
  /**
   * The live zoom, written by `applyZoom` BEFORE the state update.
   *
   * Not refreshed during render, which is what it was: holding Cmd- then
   * collapsed three presses into one step, because every one of them read the
   * same pre-render value and computed the same "next" zoom. `applyZoom` is the
   * only writer of `zoom`, so the ref leading the state by one render is exactly
   * the point rather than a risk.
   */
  const zoomRef = useRef(zoom);
  const fitRef = useRef(fitWidth);
  fitRef.current = fitWidth;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController();
    setDoc(null);
    setError(null);
    loadReaderDoc(content, ac.signal)
      .then((next) => { if (!ac.signal.aborted) setDoc(next); })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [content, nodeId]);

  const pages = doc?.pages ?? [];

  // ── Column width ──────────────────────────────────────────────────────────
  // Measured on this component's own element, which is the only DOM this file
  // touches. Everything downstream is a ratio of the number decided here.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const chrome = (toggles.column ? ASIDE_WIDTH : 0) + COLRAIL_WIDTH + 56;
      const available = el.clientWidth - chrome;
      // The FIT width only. Zoom multiplies it, so measuring must never
      // overwrite what the reader has zoomed to — resizing the window changes
      // what 100% means and leaves the zoom factor alone.
      setFitWidth(clamp(available, MIN_FIT_WIDTH, MAX_FIT_WIDTH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `doc` is a dependency because the loading and error states render a
    // DIFFERENT element and do not carry rootRef. Without it this effect ran
    // once, against a null ref, and never again — every page rendered at
    // MIN_PAGE_WIDTH on a 1440px screen and nothing about the layout said why.
  }, [doc, toggles.column]);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  /**
   * Zoom by re-rendering the page WIDER, never by `transform: scale()`.
   *
   * A transform is the easy version and it would have broken the two things
   * this reader is built on. The page image is rendered at 2x and sized down by
   * CSS precisely so it stays sharp; scaling that composited bitmap up just
   * blurs it. And every position in the reader — the rail's entries, the data
   * layer, the scroll maths — is a fraction of `columnWidth`, so a transform
   * would move the page without moving the column beside it, and the concept
   * rail would drift off the theorems it names by however much you had zoomed.
   * Changing the width instead re-lays-out both together, and `blockFrac` is
   * exact at every zoom because it never sees pixels at all.
   *
   * The anchor is held in (page, fraction) — width-independent — so the point
   * under the cursor stays under the cursor. The restore happens in a layout
   * effect below, once React has re-rendered at the new width.
   */
  const applyZoom = useCallback((next: number, anchorClientY?: number) => {
    const el = scrollRef.current;
    const prev = zoomRef.current;
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const prevWidth = columnWidthFor(fitRef.current, prev);
    const nextWidth = columnWidthFor(fitRef.current, z);
    if (nextWidth === prevWidth) return;

    if (el && pages.length) {
      const anchor = anchorClientY != null
        ? anchorClientY - el.getBoundingClientRect().top
        : el.clientHeight / 2;
      const { index, frac } = pageAtOffset(pages, prevWidth, el.scrollTop + anchor);
      pendingScrollRef.current =
        pageTop(pages, index, nextWidth) + frac * pageBoxHeight(pages[index], nextWidth) - anchor;
    }
    zoomRef.current = z;
    setZoom(z);
  }, [pages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const want = pendingScrollRef.current;
    if (!el || want == null) return;
    pendingScrollRef.current = null;
    el.scrollTop = Math.max(0, Math.min(want, el.scrollHeight - el.clientHeight));
  }, [columnWidth]);

  /** Nearest stop above or below, so the keys walk a scale rather than drift. */
  const stepZoom = useCallback((dir: 1 | -1) => {
    const z = zoomRef.current;
    const next = dir > 0
      ? ZOOM_STEPS.find((s) => s > z + 0.001)
      : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
    if (next != null) applyZoom(next);
  }, [applyZoom]);

  // Ctrl/Cmd + wheel, and trackpad pinch — which the browser reports as a wheel
  // event with ctrlKey set, so the two are the same gesture to handle here.
  //
  // Attached natively rather than through React's onWheel because React's is
  // passive: preventDefault inside it is ignored, and without preventDefault
  // the browser zooms the WHOLE app around the reader instead. That is what
  // "zoom does not work" was — the reader had no zoom, so a pinch fell through
  // to browser zoom and scaled the sidebar, the tab bar and the toolbar along
  // with the page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // deltaY is lines or pixels depending on the device; the exponential
      // keeps a trackpad pinch smooth and a mouse notch from jumping a whole
      // step at a time.
      applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0016), e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // ── Where are we ──────────────────────────────────────────────────────────
  const readPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pages.length) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;

    let pageStart = PAGE_PAD;
    let best = 0;
    let bestOverlap = -1;
    const seen: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const height = pageBoxHeight(page, columnWidth);
      const pageEnd = pageStart + height;

      const overlap = Math.min(bottom, pageEnd) - Math.max(top, pageStart);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }

      if (overlap > 0) {
        for (const block of page.blocks) {
          const f = blockFrac(page, block.bbox);
          const y0 = pageStart + f.top * height;
          const y1 = y0 + f.height * height;
          if (y1 > top && y0 < bottom) seen.push(block.id);
        }
      }
      pageStart = pageEnd + PAGE_GAP;
    }

    setCurrentPage((prev) => (prev === best ? prev : best));
    // Replacing the array every frame would re-render both columns on every
    // scroll tick; only the identity of the set matters to them.
    setVisibleBlocks((prev) =>
      prev.length === seen.length && prev.every((id, i) => id === seen[i]) ? prev : seen,
    );
  }, [pages, columnWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; readPosition(); });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    readPosition();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [readPosition]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const onNavigate = useCallback<ReaderView["onNavigate"]>((pageIndex, blockId) => {
    const el = scrollRef.current;
    const page = pages[pageIndex];
    if (!el || !page) return;

    let top = pageTop(pages, pageIndex, columnWidth);
    if (blockId) {
      const block = page.blocks.find((b) => b.id === blockId);
      // A quarter of the viewport of lead-in: landing a theorem flush against
      // the top edge reads as if the page starts there.
      if (block) {
        top += blockFrac(page, block.bbox).top * pageBoxHeight(page, columnWidth);
        top -= el.clientHeight * 0.22;
      }
    }
    scrollReaderTo(el, top - PAGE_PAD / 2);
    if (blockId) setHighlightBlock(blockId);
  }, [pages, columnWidth]);

  // The flash is a "you are here", not a selection: it has to end on its own.
  useEffect(() => {
    if (!highlightBlock) return;
    const t = setTimeout(() => setHighlightBlock(null), 1400);
    return () => clearTimeout(t);
  }, [highlightBlock]);

  const onCopyLatex = useCallback((block: ReaderBlock) => {
    if (!block.latex) return;
    void navigator.clipboard?.writeText(block.latex).then(
      () => setCopied(block.id),
      () => setCopied(null),
    );
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const onToggle = useCallback((key: keyof ReaderToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── The `d` key ───────────────────────────────────────────────────────────
  // On the container, NOT on window. A reader node is one pane among several in
  // a Vault tab; a global listener here would toggle this reader's data layer
  // while someone typed a "d" into a note in the pane beside it. The container
  // takes focus on mount and on click, and gives it up like any other element.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;

    // Cmd/Ctrl +, -, 0. Scoped to the reader like `d` — preventDefault is what
    // stops the browser zooming the whole app around the page instead.
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); stepZoom(1); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); stepZoom(-1); return; }
      if (e.key === "0") { e.preventDefault(); applyZoom(1); return; }
      return;
    }
    if (e.altKey) return;

    if (e.key === "Escape" && outlineOpen) {
      e.preventDefault();
      setOutlineOpen(false);
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === "d") {
      e.preventDefault();
      onToggle("dataLayer");
    }
  }, [onToggle, stepZoom, applyZoom, outlineOpen]);

  useEffect(() => {
    if (doc) rootRef.current?.focus({ preventScroll: true });
  }, [doc]);

  const view: ReaderView = useMemo(
    () => ({ pages, currentPage, visibleBlocks, onNavigate }),
    [pages, currentPage, visibleBlocks, onNavigate],
  );

  if (error) {
    return (
      <div className="reader-root reader-message" role="alert">
        <strong>Kunne ikke åpne leseren</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!doc) return <div className="reader-root reader-message">Laster leseren…</div>;

  return (
    <div
      ref={rootRef}
      className="reader-root"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Clicking anywhere in the reader hands it the key scope back, so `d`
      // works after a click on a rail entry without a visible focus dance.
      onMouseDown={() => rootRef.current?.focus({ preventScroll: true })}
    >
      <ToggleRails
        slot="top"
        toggles={toggles}
        onToggle={onToggle}
        currentPage={currentPage}
        pageCount={pages.length}
        printedPage={pages[currentPage]?.printedPage}
        title={doc.title}
      />

      <div className="reader-body">
        <div className="reader-scroll" ref={scrollRef}>
          <div className="reader-cols">
            {toggles.column && (
              // ONE column holding both. The concept rail is what it shows at
              // rest — entries standing beside the blocks they name, which is
              // the rail's whole job and cannot be given up. The outline is a
              // layer over it, fully transparent until the pointer enters the
              // column or focus lands in it.
              //
              // Hover alone would close it the moment you moved toward the
              // entry you were reaching for, so focus holds it open too, and
              // `focusout` (which, unlike blur, tells us where focus WENT)
              // closes it only when focus leaves the column altogether.
              <div
                ref={asideRef}
                className={`reader-aside${outlineOpen ? " is-open" : ""}`}
                style={{ width: ASIDE_WIDTH }}
                onPointerEnter={() => setOutlineOpen(true)}
                // Touch has no hover: a tap on the column is the way in there,
                // and on a mouse it is a no-op because the pointer already
                // opened it on the way to the click.
                onPointerDown={() => setOutlineOpen(true)}
                onPointerLeave={() => {
                  if (!asideRef.current?.contains(document.activeElement)) setOutlineOpen(false);
                }}
                onFocusCapture={() => setOutlineOpen(true)}
                onBlurCapture={(e) => {
                  const to = e.relatedTarget as Node | null;
                  if (!to || !asideRef.current?.contains(to)) setOutlineOpen(false);
                }}
              >
                <ConceptRail {...view} columnWidth={columnWidth} dimmed={outlineOpen} />
                <div className="reader-aside-outline-hold" aria-hidden={!outlineOpen}>
                  <div className="reader-aside-outline">
                    <OutlineColumn {...view} />
                  </div>
                </div>
              </div>
            )}
            {/* The seam, and the only chrome inside the scroll area. It sits
                here rather than on the window edge so that an "on" segment
                reads as the edge of the column it opens. */}
            <div className="reader-colrail-hold" style={{ width: COLRAIL_WIDTH }}>
              <ToggleRails slot="column" toggles={toggles} onToggle={onToggle} />
            </div>
            <ReaderPages
              {...view}
              columnWidth={columnWidth}
              dataLayer={toggles.dataLayer}
              highlightBlock={highlightBlock}
              onCopyLatex={onCopyLatex}
              latexIsTranscribed={doc.source.latexIsTranscribed === true}
            />
          </div>
        </div>
      </div>

      {copied && <div className="reader-toast" role="status">LaTeX kopiert</div>}
    </div>
  );
}
