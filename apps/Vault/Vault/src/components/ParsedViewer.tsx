import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { HighlighterCatEditor } from "./HighlighterCatEditor";
import * as api from "../lib/api";
import { DEFAULT_HIGHLIGHTERS } from "../nodeUtils";
import { useResizableWidth } from "../hooks/useResizableWidth";
import type { VaultGraph, HighlighterCategory } from "../types";
import { KATEX_OPTS } from "../lib/katexShared";
import { MarginInkLayer, type MarginInkHandle } from "./MarginInkLayer";
import { ConceptPanel } from "./ConceptPanel";

interface Props {
  content: string;               // pre-rendered full-fidelity HTML (see md ingest)
  onChange: (content: string) => void; // unused: highlights persist as records, not content
  nodeId: string;
  graph?: VaultGraph;
}

const BASE_FONT = 16.5;
const FONT_MIN = 0.8, FONT_MAX = 1.8, FONT_STEP = 0.1;

type MarginTool = "pen" | "highlighter" | "eraser";
const MARGIN_COLORS = ["#1d4ed8", "#dc2626", "#16a34a", "#ea580c", "#18181b"];

// The parsed HTML is authored by our own ingest pipeline (not user input), so
// rendering it directly is safe and preserves all book formatting.
function catKey(name: string) {
  return "pvhl-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

interface OutlineItem { id: string; text: string; level: number; index: number; }

export function ParsedViewer({ content, nodeId }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const highlightsRef = useRef<Map<string, any>>(new Map());
  const searchHlRef = useRef<any>(null);
  const searchActiveHlRef = useRef<any>(null);
  const bmSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [highlighters, setHighlighters] = useState<HighlighterCategory[]>([]);
  const [editingCats, setEditingCats] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const [sidebarTab, setSidebarTab] = useState<"outline" | "bookmarks" | "concepts">("outline");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const outlineResize = useResizableWidth("nexus.parsed.outlineWidth", 260, 180, 760);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [fontScale, setFontScale] = useState(() => {
    const v = Number(localStorage.getItem(`nexus.parsed.font.${nodeId}`));
    return v >= FONT_MIN && v <= FONT_MAX ? v : 1;
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [matchIdx, setMatchIdx] = useState(0);
  const matchesRef = useRef<Range[]>([]);

  // ── Margin notes (jotting margins on both sides of the page) ───────────────
  const [marginsOn, setMarginsOn] = useState(() => localStorage.getItem(`vault.margins.${nodeId}`) === "1");
  const [marginTool, setMarginTool] = useState<MarginTool>("pen");
  const [marginColor, setMarginColor] = useState(MARGIN_COLORS[0]);
  const marginInkRef = useRef<MarginInkHandle>(null);
  // scrollRef/rootRef (above) are read synchronously all over this file, so
  // they must keep working exactly as before. But a plain ref never triggers
  // a re-render when it first attaches — passed straight through as props,
  // MarginInkLayer would see `null` on its very first render and stay stuck
  // on that stale value forever (props only update via a parent re-render).
  // These callback refs dual-assign into the existing mutable refs AND into
  // state, so the state update forces the re-render that hands MarginInkLayer
  // the real elements once they exist.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    localStorage.setItem(`vault.margins.${nodeId}`, marginsOn ? "1" : "0");
  }, [marginsOn, nodeId]);

  const supportsHighlightApi =
    typeof (window as any).Highlight === "function" && (CSS as any).highlights;

  function styleSheet() {
    if (!styleRef.current) {
      styleRef.current = document.createElement("style");
      document.head.appendChild(styleRef.current);
    }
    return styleRef.current.sheet!;
  }

  // ── Render HTML + KaTeX + build outline ────────────────────────────────────
  //
  // ⚠️ Math renders LAZILY. Kalkulus carries 4,273 block equations, and the
  // old effect ran katex.render on every one of them before first paint —
  // seconds of open-time jank on a Mac and a killed page on an iPad. An
  // IntersectionObserver now renders each equation as it approaches the
  // viewport (two screens of margin, so reading pace never catches the
  // renderer). Anything that must reason about the WHOLE document — the
  // search index, printing — should call the returned render-all escape
  // hatch, not assume the math is materialised.
  //
  // Images get loading="lazy" + decoding="async" IN THE STRING, before
  // innerHTML — set afterwards, Safari has already started fetching all of
  // them. On an iPad this is the difference between figures and the grey
  // placeholder: iOS evicts decoded images under memory pressure, and a
  // 2 MB single-layer page with 200 eager images is over budget by itself.
  const mathObserverRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = typeof content === "string" ? content : "";
    root.innerHTML = html.replace(/<img (?![^>]*loading=)/g, '<img loading="lazy" decoding="async" ');

    // ⚠️ Batch the flat block stream into <section> shells. content-visibility
    // is the load-bearing iPad fix, but applied per block it hands WebKit
    // ~7,000 tracked elements whose skip/render bookkeeping runs during every
    // scroll — measured on the iPad simulator as the dominant residual cost
    // (frames slow with NO long script tasks). ~100 sections cut at chapter
    // boundaries give the same off-screen skipping at 1/70th the bookkeeping.
    // Sections are unstyled block wrappers, so layout geometry is unchanged;
    // headings keep their ids for the outline, and geometry reads on hidden
    // content still force materialisation per the c-v spec.
    if (root.children.length > 200) {
      const kids = Array.from(root.children);
      const frag = document.createDocumentFragment();
      let sec: HTMLElement | null = null;
      let count = 0;
      for (const el of kids) {
        const tag = el.tagName;
        if (!sec || tag === "H1" || tag === "H2" || count >= 80) {
          sec = document.createElement("section");
          sec.className = "pv-sec";
          frag.appendChild(sec);
          count = 0;
        }
        sec.appendChild(el);
        count++;
      }
      root.appendChild(frag);
    }

    mathObserverRef.current?.disconnect();
    const renderMath = (el: HTMLElement) => {
      if (el.dataset.mathDone) return;
      el.dataset.mathDone = "1";
      const display = el.getAttribute("data-type") === "block-math";
      try { katex.render(el.getAttribute("data-latex") || "", el, { ...KATEX_OPTS, displayMode: display }); }
      catch { /* keep raw */ }
    };
    const mathEls = root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]');
    if ("IntersectionObserver" in window) {
      // ⚠️ Approaching equations are QUEUED, not rendered in the observer
      // callback. A fast flick brings dozens into the apron in one tick, and
      // rendering them synchronously is a 100ms+ burst in a single frame —
      // measured on the iPad simulator as most of the residual scroll jank.
      // A few per frame keeps every frame short; the queue drains in well
      // under the time the apron buys.
      const queue: HTMLElement[] = [];
      let pumping = 0;
      const pump = () => {
        pumping = 0;
        const batch = queue.splice(0, 4);
        for (const el of batch) renderMath(el);
        if (queue.length) pumping = requestAnimationFrame(pump);
      };
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { queue.push(e.target as HTMLElement); io.unobserve(e.target); }
        if (queue.length && !pumping) pumping = requestAnimationFrame(pump);
      }, { root: scrollRef.current, rootMargin: "2000px 0px" });
      mathEls.forEach((el) => io.observe(el));
      mathObserverRef.current = io;
    } else {
      mathEls.forEach(renderMath);
    }

    const items: OutlineItem[] = [];
    root.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach((el, i) => {
      const text = (el.textContent || "").trim();
      if (!text) return;
      el.id = el.id || `pv-h-${i}`;
      items.push({ id: el.id, text, level: Number(el.tagName[1]), index: i });
    });
    setOutline(items);
    return () => { mathObserverRef.current?.disconnect(); };
  }, [content]);

  // font scale → root font-size (KaTeX is em-based, so math scales too).
  //
  // ⚠️ Scaling REFLOWS the whole document, and scrollTop is a pixel offset
  // into it — keep the offset and the same pixel now points at a different
  // paragraph, so zooming used to teleport the reader. The fix is an anchor:
  // before applying the new size, record which block sits at the top of the
  // viewport (binary search over offsetTop — the content is thousands of
  // siblings) and how far into it the view is, as a FRACTION of the block
  // (fractions survive reflow; pixel deltas scale). After the style lands,
  // scroll so that block is back at the same fraction. useLayoutEffect keeps
  // capture → apply → restore inside one frame, so nothing flashes.
  const prevScaleRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current, sc = scrollRef.current;
    if (!root) return;
    const rescaling = prevScaleRef.current !== null
      && prevScaleRef.current !== fontScale && sc && root.children.length > 0;
    let anchor: { el: HTMLElement; frac: number } | null = null;
    if (rescaling && sc) {
      const target = sc.scrollTop + root.offsetTop;
      // Binary search by offsetTop; sections are unpositioned wrappers, so
      // every block's offsetTop resolves against the same offsetParent and
      // the search can descend section → block for a paragraph-sized anchor.
      const pick = (kids: HTMLCollection): HTMLElement => {
        let lo = 0, hi = kids.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if ((kids[mid] as HTMLElement).offsetTop <= target) lo = mid; else hi = mid - 1;
        }
        return kids[lo] as HTMLElement;
      };
      let el = pick(root.children);
      if (el.classList.contains("pv-sec") && el.children.length) el = pick(el.children);
      anchor = { el, frac: el.offsetHeight > 0 ? (target - el.offsetTop) / el.offsetHeight : 0 };
    }
    root.style.fontSize = `${(BASE_FONT * fontScale).toFixed(1)}px`;
    if (anchor && sc) {
      // Reading offsetTop after the style write forces the reflow we need.
      sc.scrollTop = anchor.el.offsetTop + anchor.frac * anchor.el.offsetHeight - root.offsetTop;
    }
    prevScaleRef.current = fontScale;
    localStorage.setItem(`nexus.parsed.font.${nodeId}`, String(fontScale));
  }, [fontScale, content, nodeId]);

  // ── Pinch-to-zoom on the reading surface (iPad) ──
  // Two fingers on the book adjust the SAME fontScale the A−/A+ buttons use,
  // instead of falling through to Safari's whole-app visual-viewport zoom.
  // Native pinch is suppressed only when two touches are actually on the
  // page (non-passive touchmove + gesturestart preventDefault — React's
  // touch listeners are passive, same constraint as MarginInkLayer's stylus
  // handler). One finger still scrolls natively. The reflow anchoring above
  // makes the continuous rescale hold position.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let startDist = 0, startScale = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        startScale = Number(rootRef.current?.style.fontSize?.replace("px", "") || BASE_FONT) / BASE_FONT;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const raw = startScale * (dist(e.touches) / startDist);
      const stepped = Math.round(raw / FONT_STEP) * FONT_STEP;
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, +stepped.toFixed(2)));
      setFontScale(prev => (prev === next ? prev : next));
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) startDist = 0; };
    const onGesture = (e: Event) => e.preventDefault();  // Safari's proprietary path
    sc.addEventListener("touchstart", onTouchStart, { passive: true });
    sc.addEventListener("touchmove", onTouchMove, { passive: false });
    sc.addEventListener("touchend", onTouchEnd, { passive: true });
    sc.addEventListener("gesturestart", onGesture as EventListener);
    sc.addEventListener("gesturechange", onGesture as EventListener);
    return () => {
      sc.removeEventListener("touchstart", onTouchStart);
      sc.removeEventListener("touchmove", onTouchMove);
      sc.removeEventListener("touchend", onTouchEnd);
      sc.removeEventListener("gesturestart", onGesture as EventListener);
      sc.removeEventListener("gesturechange", onGesture as EventListener);
    };
  }, [content]);

  // ── Highlighter categories ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let sets = await api.readHighlighters(nodeId);
      if (sets.length === 0) { sets = DEFAULT_HIGHLIGHTERS; await api.saveHighlighters(nodeId, sets); }
      if (!cancelled) setHighlighters(sets);
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  // ── Bookmarks: load ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await api.readContent(nodeId + "_bookmarks");
        const arr = raw ? JSON.parse(raw) : [];
        if (!cancelled && Array.isArray(arr)) setBookmarks(new Set(arr));
      } catch { /* none yet */ }
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  function toggleBookmark(id: string) {
    setBookmarks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (bmSaveTimer.current) clearTimeout(bmSaveTimer.current);
      const snapshot = [...next];
      bmSaveTimer.current = setTimeout(() => {
        api.saveContent(nodeId + "_bookmarks", JSON.stringify(snapshot)).catch(() => {});
      }, 500);
      return next;
    });
  }

  function ensureHighlight(cat: HighlighterCategory) {
    const key = catKey(cat.name);
    let hl = highlightsRef.current.get(key);
    if (!hl && supportsHighlightApi) {
      hl = new (window as any).Highlight();
      highlightsRef.current.set(key, hl);
      (CSS as any).highlights.set(key, hl);
      styleSheet().insertRule(`::highlight(${key}){ background-color:${cat.color}; color:inherit; }`);
    }
    return hl;
  }

  // ── Rebuild saved highlights from records ──────────────────────────────────
  useEffect(() => {
    if (!supportsHighlightApi || highlighters.length === 0) return;
    let cancelled = false;
    (async () => {
      const records = await api.readRecordsForSources([nodeId]);
      if (cancelled || !rootRef.current) return;
      const idx = buildTextIndex(rootRef.current);
      const catByName = new Map(highlighters.map((c) => [c.name, c]));
      for (const rec of records) {
        const cat = catByName.get(rec.category) ?? { name: rec.category, color: rec.color };
        const r = findRange(idx, rec.text);
        if (r) ensureHighlight(cat)?.add(r);
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId, highlighters, content]);

  // ── Track selection inside the reader ──────────────────────────────────────
  useEffect(() => {
    function onSel() {
      const sel = window.getSelection();
      const inside = !!sel && !sel.isCollapsed && !!rootRef.current &&
        rootRef.current.contains(sel.anchorNode) && rootRef.current.contains(sel.focusNode);
      setHasSelection(inside);
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // ── Scroll-spy for the outline ─────────────────────────────────────────────
  //
  // ⚠️ NOT a scroll listener. The old spy walked the headings calling
  // getBoundingClientRect per heading on EVERY scroll event — and under
  // content-visibility a geometry read forces the hidden block to lay out,
  // so each scroll event forced layout of every heading-block above the
  // reading position. Measured on the iPad simulator that was 193 ms per
  // frame; the spy alone was most of "can barely interact". An
  // IntersectionObserver reports crossings with geometry ATTACHED (no
  // forced layout, no per-scroll work): a heading is "passed" when it sits
  // above the top band, and the active section is the last passed one in
  // document order.
  useEffect(() => {
    const scroller = scrollRef.current;
    const root = rootRef.current;
    if (!scroller || !root || outline.length === 0) return;
    const order = new Map(outline.map((it, i) => [it.id, i]));
    const passed = new Array<boolean>(outline.length).fill(false);
    let raf = 0;
    const recompute = () => {
      raf = 0;
      let current = 0;
      for (let i = 0; i < passed.length; i++) if (passed[i]) current = i;
      setActiveId(outline[current]?.id ?? null);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = order.get((e.target as HTMLElement).id);
        if (i === undefined || !e.rootBounds) continue;
        passed[i] = e.boundingClientRect.top <= e.rootBounds.top + 60;
      }
      if (!raf) raf = requestAnimationFrame(recompute);
    }, { root: scroller, rootMargin: "60px 0px -100% 0px" });
    for (const it of outline) {
      const el = document.getElementById(it.id);
      if (el) io.observe(el);
    }
    return () => { io.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [outline]);

  function scrollToHeading(item: OutlineItem) {
    const root = rootRef.current, scroller = scrollRef.current;
    if (!root || !scroller) return;
    const els = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
    const el = els[item.index] ?? root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
    if (!el) return;
    // Instant scroll: behavior:"smooth" relies on rAF, which is throttled when
    // the tab isn't foregrounded — a jump-to-section must always land.
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
    scroller.scrollTop = top;
  }

  function applyCategory(cat: HighlighterCategory) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !rootRef.current) return;
    const range = sel.getRangeAt(0);
    if (!rootRef.current.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (supportsHighlightApi) ensureHighlight(cat)?.add(range.cloneRange());
    if (text) {
      api.insertRecord({ source_node_id: nodeId, category: cat.name, color: cat.color, text, location: "" })
        .catch(() => {});
    }
    sel.removeAllRanges();
    setHasSelection(false);
  }

  function persistHighlighters(next: HighlighterCategory[]) {
    setHighlighters(next);
    api.saveHighlighters(nodeId, next);
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  const runSearch = useCallback((q: string) => {
    const root = rootRef.current;
    if (!root) return;
    const norm = q.replace(/\s+/g, " ").trim().toLowerCase();
    const matches: Range[] = [];
    if (norm.length >= 2 && supportsHighlightApi) {
      const idx = buildTextIndex(root);
      const hay = idx.norm.toLowerCase();
      let from = 0, at: number;
      while ((at = hay.indexOf(norm, from)) !== -1) {
        const r = rangeFromNorm(idx, at, norm.length);
        if (r) matches.push(r);
        from = at + norm.length;
        if (matches.length > 5000) break;
      }
    }
    matchesRef.current = matches;
    setMatchCount(matches.length);
    setMatchIdx(matches.length ? 0 : -1);
    if (supportsHighlightApi) {
      if (!searchHlRef.current) {
        searchHlRef.current = new (window as any).Highlight();
        searchActiveHlRef.current = new (window as any).Highlight();
        (CSS as any).highlights.set("pv-search", searchHlRef.current);
        (CSS as any).highlights.set("pv-search-active", searchActiveHlRef.current);
        styleSheet().insertRule("::highlight(pv-search){ background-color:#ffe58a; color:#000; }");
        styleSheet().insertRule("::highlight(pv-search-active){ background-color:#ff9f43; color:#000; }");
      }
      searchHlRef.current.clear();
      searchActiveHlRef.current.clear();
      matches.forEach((r) => searchHlRef.current.add(r));
      if (matches.length) focusMatch(0, matches);
    }
  }, [supportsHighlightApi]);

  function focusMatch(i: number, list = matchesRef.current) {
    if (!list.length || !searchActiveHlRef.current) return;
    const n = ((i % list.length) + list.length) % list.length;
    searchActiveHlRef.current.clear();
    searchActiveHlRef.current.add(list[n]);
    setMatchIdx(n);
    const el = list[n].startContainer.parentElement;
    const scroller = scrollRef.current;
    if (el && scroller) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        + scroller.scrollTop - scroller.clientHeight / 2;
      scroller.scrollTop = Math.max(0, top);
    }
  }

  // debounce query
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 180);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  function closeSearch() {
    setSearchOpen(false); setQuery(""); setMatchCount(0);
    searchHlRef.current?.clear();
    searchActiveHlRef.current?.clear();
  }

  // ⌘F / Ctrl+F opens search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault(); setSearchOpen(true);
      } else if (e.key === "Escape" && searchOpen) closeSearch();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const bmItems = outline.filter((o) => bookmarks.has(o.id));

  return (
    <div className="parsed-viewer">
      <div className="tiptap-toolbar parsed-toolbar">
        <button className={`tt-btn${sidebarOpen ? " active" : ""}`} onClick={() => setSidebarOpen((o) => !o)} type="button" title="Toggle sidebar">◧</button>
        <span className="parsed-badge">❖ Parsed</span>
        <div className="tt-sep" />
        {/* font zoom */}
        <button className="tt-btn" onClick={() => setFontScale((s) => Math.max(FONT_MIN, +(s - FONT_STEP).toFixed(2)))} type="button" title="Smaller text">A−</button>
        <button className="tt-btn" onClick={() => setFontScale(1)} type="button" title="Reset text size">{Math.round(fontScale * 100)}%</button>
        <button className="tt-btn" onClick={() => setFontScale((s) => Math.min(FONT_MAX, +(s + FONT_STEP).toFixed(2)))} type="button" title="Larger text">A+</button>
        <div className="tt-sep" />
        {/* search */}
        <button className={`tt-btn${searchOpen ? " active" : ""}`} onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))} type="button" title="Search (⌘F)">🔍</button>
        {searchOpen && (
          <span className="parsed-search">
            <input
              className="parsed-search-input"
              autoFocus
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") focusMatch(matchIdx + (e.shiftKey ? -1 : 1)); }}
            />
            <span className="parsed-search-count">{matchCount ? `${matchIdx + 1}/${matchCount}` : (query ? "0" : "")}</span>
            <button className="tt-btn" onClick={() => focusMatch(matchIdx - 1)} disabled={!matchCount} title="Previous">◀</button>
            <button className="tt-btn" onClick={() => focusMatch(matchIdx + 1)} disabled={!matchCount} title="Next">▶</button>
            <button className="tt-btn" onClick={closeSearch} title="Close">✕</button>
          </span>
        )}
        <div className="tt-sep" />
        {/* highlighters */}
        {highlighters.map((cat) => (
          <button key={cat.name} className="tt-btn tt-hl-btn" onClick={() => applyCategory(cat)} disabled={!hasSelection} type="button" title={hasSelection ? `Highlight as ${cat.name}` : "Select text first"}>
            <span className="tt-hl-swatch" style={{ background: cat.color }} />
            {cat.name}
          </button>
        ))}
        <button className="tt-btn" onClick={() => setEditingCats((v) => !v)} type="button" title="Edit highlighters">✎</button>
        <div className="tt-sep" />
        {/* margin notes */}
        <button className={`tt-btn${marginsOn ? " active" : ""}`} onClick={() => setMarginsOn((v) => !v)} type="button" title="Margin notes">✎ Margins</button>
        {marginsOn && (
          <>
            <button className={`tt-btn${marginTool === "pen" ? " active" : ""}`} onClick={() => setMarginTool("pen")} type="button" title="Pen">Pen</button>
            <button className={`tt-btn${marginTool === "highlighter" ? " active" : ""}`} onClick={() => setMarginTool("highlighter")} type="button" title="Highlighter">High</button>
            <button className={`tt-btn${marginTool === "eraser" ? " active" : ""}`} onClick={() => setMarginTool("eraser")} type="button" title="Eraser">Erase</button>
            <span className="parsed-margin-colors">
              {MARGIN_COLORS.map((c) => (
                <button
                  key={c}
                  className={`parsed-margin-dot${marginColor === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setMarginColor(c)}
                  type="button"
                  title={c}
                />
              ))}
            </span>
            <button className="tt-btn" onClick={() => marginInkRef.current?.undo()} type="button" title="Undo last margin stroke">↶</button>
          </>
        )}
      </div>
      {editingCats && (
        <HighlighterCatEditor cats={highlighters} onChange={persistHighlighters} onClose={() => setEditingCats(false)} />
      )}
      <div className="parsed-body">
        {sidebarOpen && (
          <aside
            className="parsed-outline"
            style={{ width: outlineResize.width, flexBasis: outlineResize.width }}
          >
            <div className="parsed-outline-tabs">
              <button className={sidebarTab === "outline" ? "active" : ""} onClick={() => setSidebarTab("outline")}>Outline</button>
              <button className={sidebarTab === "bookmarks" ? "active" : ""} onClick={() => setSidebarTab("bookmarks")}>★ {bookmarks.size || ""}</button>
              <button className={sidebarTab === "concepts" ? "active" : ""} onClick={() => setSidebarTab("concepts")}>Concepts</button>
            </div>
            {sidebarTab === "concepts" ? (
              <ConceptPanel nodeId={nodeId} />
            ) : sidebarTab === "outline" ? (
              outline.map((h) => (
                <div key={h.id} className={`parsed-outline-row${activeId === h.id ? " active" : ""}`}>
                  <button className={`parsed-outline-item pv-ol-${h.level}`} onClick={() => scrollToHeading(h)} title={h.text}>{h.text}</button>
                  <button className={`parsed-bm-star${bookmarks.has(h.id) ? " on" : ""}`} onClick={() => toggleBookmark(h.id)} title="Bookmark section">{bookmarks.has(h.id) ? "★" : "☆"}</button>
                </div>
              ))
            ) : bmItems.length ? (
              bmItems.map((h) => (
                <div key={h.id} className="parsed-outline-row">
                  <button className={`parsed-outline-item pv-ol-${h.level}`} onClick={() => scrollToHeading(h)} title={h.text}>{h.text}</button>
                  <button className="parsed-bm-star on" onClick={() => toggleBookmark(h.id)} title="Remove bookmark">★</button>
                </div>
              ))
            ) : (
              <div className="parsed-bm-empty">No bookmarks yet — tap ☆ next to a section.</div>
            )}
          </aside>
        )}
        {sidebarOpen && (
          <div className="pv-resize" onPointerDown={outlineResize.startResize} title="Drag to resize" />
        )}
        {/* Wrapper is the positioned ancestor for the margin-ink canvas, which
            must stay viewport-fixed (NOT scroll with .parsed-content) and
            repaint itself against live scroll position instead. Keeping the
            canvas OUTSIDE .parsed-scroll as an absolutely-inset sibling means
            it never scrolls at all — no position:sticky bookkeeping needed. */}
        <div className="parsed-scroll-wrap">
          <div
            ref={(el) => { scrollRef.current = el; setScrollEl(el); }}
            className={`parsed-scroll${marginsOn ? " parsed-margins-on" : ""}`}
          >
            <div
              ref={(el) => { rootRef.current = el; setContentEl(el); }}
              className="parsed-content"
            />
          </div>
          <MarginInkLayer
            ref={marginInkRef}
            nodeId={nodeId}
            scrollEl={scrollEl}
            contentEl={contentEl}
            enabled={marginsOn}
            tool={marginTool}
            color={marginColor}
          />
        </div>
      </div>
    </div>
  );
}

// ── Text index over the rendered DOM (skips KaTeX internals) ─────────────────
interface TextIndex { nodes: { node: Text; start: number; len: number }[]; norm: string; map: number[]; }

function buildTextIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement && n.parentElement.closest(".katex"))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: TextIndex["nodes"] = [];
  let raw = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push({ node: t, start: raw.length, len: t.nodeValue!.length });
    raw += t.nodeValue;
  }
  let norm = ""; const map: number[] = []; let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) { if (prevSpace) continue; norm += " "; map.push(i); prevSpace = true; }
    else { norm += raw[i]; map.push(i); prevSpace = false; }
  }
  return { nodes, norm, map };
}

function rangeFromNorm(idx: TextIndex, at: number, len: number): Range | null {
  if (at < 0 || at + len > idx.map.length) return null;
  const rawStart = idx.map[at];
  const rawEnd = idx.map[at + len - 1] + 1;
  const pt = (rawIdx: number) => {
    for (const e of idx.nodes) if (rawIdx < e.start + e.len) return { node: e.node, offset: rawIdx - e.start };
    const last = idx.nodes[idx.nodes.length - 1];
    return { node: last.node, offset: last.len };
  };
  try {
    const r = document.createRange();
    const s = pt(rawStart), e = pt(rawEnd);
    r.setStart(s.node, s.offset); r.setEnd(e.node, e.offset);
    return r;
  } catch { return null; }
}

function findRange(idx: TextIndex, needle: string): Range | null {
  const clean = needle.replace(/\s+/g, " ").trim();
  if (clean.length < 4) return null;
  const at = idx.norm.indexOf(clean);
  return at < 0 ? null : rangeFromNorm(idx, at, clean.length);
}
