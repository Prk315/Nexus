import { useEffect, useRef, useState, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { HighlighterCatEditor } from "./HighlighterCatEditor";
import * as api from "../lib/api";
import { DEFAULT_HIGHLIGHTERS } from "../nodeUtils";
import type { VaultGraph, HighlighterCategory } from "../types";

interface Props {
  content: string;               // pre-rendered full-fidelity HTML (see md ingest)
  onChange: (content: string) => void; // unused: highlights persist as records, not content
  nodeId: string;
  graph?: VaultGraph;
}

const BASE_FONT = 16.5;
const FONT_MIN = 0.8, FONT_MAX = 1.8, FONT_STEP = 0.1;

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"outline" | "bookmarks">("outline");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
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
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = typeof content === "string" ? content : "";
    root.querySelectorAll<HTMLElement>('[data-type="inline-math"]').forEach((el) => {
      try { katex.render(el.getAttribute("data-latex") || "", el, { throwOnError: false, displayMode: false }); } catch { /* keep raw */ }
    });
    root.querySelectorAll<HTMLElement>('[data-type="block-math"]').forEach((el) => {
      try { katex.render(el.getAttribute("data-latex") || "", el, { throwOnError: false, displayMode: true }); } catch { /* keep raw */ }
    });
    const items: OutlineItem[] = [];
    root.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach((el, i) => {
      const text = (el.textContent || "").trim();
      if (!text) return;
      el.id = el.id || `pv-h-${i}`;
      items.push({ id: el.id, text, level: Number(el.tagName[1]), index: i });
    });
    setOutline(items);
  }, [content]);

  // font scale → root font-size (KaTeX is em-based, so math scales too)
  useEffect(() => {
    if (rootRef.current) rootRef.current.style.fontSize = `${(BASE_FONT * fontScale).toFixed(1)}px`;
    localStorage.setItem(`nexus.parsed.font.${nodeId}`, String(fontScale));
  }, [fontScale, content, nodeId]);

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
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || outline.length === 0) return;
    function onScroll() {
      const top = scroller!.getBoundingClientRect().top;
      let current: string | null = outline[0]?.id ?? null;
      for (const it of outline) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= top + 60) current = it.id;
        else break;
      }
      setActiveId(current);
    }
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
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
      </div>
      {editingCats && (
        <HighlighterCatEditor cats={highlighters} onChange={persistHighlighters} onClose={() => setEditingCats(false)} />
      )}
      <div className="parsed-body">
        {sidebarOpen && (
          <aside className="parsed-outline">
            <div className="parsed-outline-tabs">
              <button className={sidebarTab === "outline" ? "active" : ""} onClick={() => setSidebarTab("outline")}>Outline</button>
              <button className={sidebarTab === "bookmarks" ? "active" : ""} onClick={() => setSidebarTab("bookmarks")}>★ {bookmarks.size || ""}</button>
            </div>
            {sidebarTab === "outline" ? (
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
        <div ref={scrollRef} className="parsed-scroll">
          <div ref={rootRef} className="parsed-content" />
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
