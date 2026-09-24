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
  DEFAULT_CONCEPT_FILTER, PAGE_GAP, PAGE_PAD, pageBoxHeight, pageTop,
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

const OUTLINE_WIDTH = 210;
const RAIL_WIDTH = 132;
const MIN_PAGE_WIDTH = 360;
const MAX_PAGE_WIDTH = 900;

interface Props {
  /** The node's stored content: a pointer, or the reader JSON itself. */
  content: string;
  nodeId: string;
}

export function ReaderEditor({ content, nodeId }: Props) {
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [toggles, setToggles] = useState<ReaderToggles>({
    outline: true, conceptRail: true, dataLayer: false,
  });
  const [filter, setFilter] = useState(DEFAULT_CONCEPT_FILTER);
  const [currentPage, setCurrentPage] = useState(0);
  const [visibleBlocks, setVisibleBlocks] = useState<string[]>([]);
  const [highlightBlock, setHighlightBlock] = useState<string | null>(null);
  const [columnWidth, setColumnWidth] = useState(MIN_PAGE_WIDTH);
  const [copied, setCopied] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const chrome =
        (toggles.outline ? OUTLINE_WIDTH : 0) + (toggles.conceptRail ? RAIL_WIDTH : 0) + 88;
      const available = el.clientWidth - chrome;
      setColumnWidth(Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, available)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `doc` is a dependency because the loading and error states render a
    // DIFFERENT element and do not carry rootRef. Without it this effect ran
    // once, against a null ref, and never again — every page rendered at
    // MIN_PAGE_WIDTH on a 1440px screen and nothing about the layout said why.
  }, [doc, toggles.outline, toggles.conceptRail]);

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
        const scale = height / page.height;
        for (const block of page.blocks) {
          const y0 = pageStart + block.bbox[1] * scale;
          const y1 = pageStart + block.bbox[3] * scale;
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
        top += (block.bbox[1] / page.height) * pageBoxHeight(page, columnWidth);
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
    if (e.key !== "d" || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
    e.preventDefault();
    onToggle("dataLayer");
  }, [onToggle]);

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
            {toggles.outline && (
              <div className="reader-outline-hold" style={{ width: OUTLINE_WIDTH }}>
                <OutlineColumn {...view} />
              </div>
            )}
            {toggles.conceptRail && (
              <div className="reader-rail-hold" style={{ width: RAIL_WIDTH }}>
                <ConceptRail
                  {...view}
                  columnWidth={columnWidth}
                  filter={filter}
                  onFilterChange={setFilter}
                />
              </div>
            )}
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
