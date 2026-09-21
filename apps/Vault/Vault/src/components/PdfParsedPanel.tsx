import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import * as api from "../lib/api";
import { KATEX_OPTS } from "../lib/katexShared";
import { ConceptPanel } from "./ConceptPanel";
import {
  buildAnchors, pageOfIndex, sliceForPage, sourceForPage,
  type Companion, type PageAnchor,
} from "../lib/hybridPdf";

// The parsed DATA layer beside the PDF's pixels — the hybrid's working half.
// The PDF stays the visual truth (the book as the author set it); this panel
// answers everything pixels can't: selectable text for the page you're on,
// every equation with its LaTeX one tap from the clipboard, the concepts
// database, and search that lands on a printed page. All of it reads the
// SAME parsed nodes the Parsed viewer renders, resolved through the PDF
// node's `{id}_companion` row.

interface ParsedDoc { html: string; anchors: PageAnchor[] }
// Session cache — a parsed half is ~2 MB and switching PDF pages must not
// refetch it. Keyed by parsed node id, shared across mounts.
const parsedDocCache = new Map<string, ParsedDoc>();

type ContentLoader = (id: string) => Promise<string | null>;

async function loadParsed(
  source: { node: string; chapters: Record<string, [number, number]> },
  load: ContentLoader,
): Promise<ParsedDoc | null> {
  const hit = parsedDocCache.get(source.node);
  if (hit) return hit;
  const html = await load(source.node);
  if (!html) return null;
  const doc = { html, anchors: buildAnchors(html, source.chapters) };
  parsedDocCache.set(source.node, doc);
  return doc;
}

/** Strip tags, keeping a map from text position → html position so a search
 *  hit in readable text can be located (and paged) in the raw HTML. */
export function textWithMap(html: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === "<") { inTag = true; continue; }
    if (inTag) { if (c === ">") inTag = false; continue; }
    text += c;
    map.push(i);
  }
  return { text, map };
}

interface SearchHit { node: string; page: number | null; snippet: string }

function PageSlice({ companion, page1, load }: { companion: Companion; page1: number; load: ContentLoader }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ s: "loading" } | { s: "missing" } | { s: "ready"; from: number; to: number }>({ s: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ s: "loading" });
    (async () => {
      const source = sourceForPage(companion, page1);
      const doc = source ? await loadParsed(source, load) : null;
      if (cancelled) return;
      const host = hostRef.current;
      const slice = doc ? sliceForPage(doc.html, doc.anchors, page1) : null;
      if (!slice || !host) { setState({ s: "missing" }); return; }
      host.innerHTML = slice.html;
      // A slice is page-sized, so unlike the full Parsed view the math can
      // render eagerly — and every equation becomes a copy-LaTeX target.
      host.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]').forEach((el) => {
        const display = el.getAttribute("data-type") === "block-math";
        try { katex.render(el.getAttribute("data-latex") || "", el, { ...KATEX_OPTS, displayMode: display }); }
        catch { /* keep raw */ }
        el.classList.add("pv-copy-math");
        el.title = "Tap to copy LaTeX";
      });
      setState({ s: "ready", from: slice.from, to: slice.to });
    })();
    return () => { cancelled = true; };
  }, [companion, page1]);

  function onClick(e: React.MouseEvent) {
    const math = (e.target as HTMLElement).closest<HTMLElement>("[data-latex]");
    if (!math) return;
    const latex = math.getAttribute("data-latex") || "";
    navigator.clipboard?.writeText(latex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }

  return (
    <div className="pdf-parsed-scroll">
      {state.s === "loading" && <div className="concept-empty">Loading…</div>}
      {state.s === "missing" && (
        <div className="concept-empty">No parsed text is mapped to this page.</div>
      )}
      {state.s === "ready" && (
        <div className="pdf-parsed-range">
          {Number.isNaN(state.from) ? "whole book" : state.from === state.to ? `p. ${state.from}` : `pp. ${state.from}–${state.to}`}
          {copied && <span className="pv-copied">LaTeX copied</span>}
        </div>
      )}
      <div ref={hostRef} className="parsed-content pdf-parsed-slice" onClick={onClick} />
    </div>
  );
}

function ParsedSearch({ companion, onGoToPage, load }: { companion: Companion; onGoToPage: (pageIdx0: number) => void; load: ContentLoader }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return;
    setBusy(true);
    const out: SearchHit[] = [];
    for (const source of companion.parsed) {
      const doc = await loadParsed(source, load);
      if (!doc) continue;
      const { text, map } = textWithMap(doc.html);
      const hay = text.toLowerCase();
      let i = 0;
      while (out.length < 60) {
        const at = hay.indexOf(needle, i);
        if (at < 0) break;
        out.push({
          node: source.node,
          page: pageOfIndex(doc.anchors, map[at]),
          snippet: text.slice(Math.max(0, at - 60), at + needle.length + 60).replace(/\s+/g, " ").trim(),
        });
        i = at + needle.length;
      }
      if (out.length >= 60) break;
    }
    setHits(out);
    setBusy(false);
  }

  return (
    <div className="pdf-parsed-scroll">
      <div className="concept-controls">
        <input
          className="concept-search"
          placeholder="Search the parsed text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        />
        <button className="tt-btn" onClick={run} disabled={busy} type="button">{busy ? "…" : "Go"}</button>
      </div>
      {hits && !hits.length && <div className="concept-empty">Nothing matches.</div>}
      {hits?.map((h, i) => (
        <button
          key={i}
          className="pv-search-hit"
          type="button"
          disabled={h.page === null}
          onClick={() => { if (h.page !== null) onGoToPage(h.page - 1); }}
          title={h.page === null ? "No page mapping for this book" : `Go to p. ${h.page}`}
        >
          <span className="pv-search-page">{h.page === null ? "—" : `p. ${h.page}`}</span>
          <span className="pv-search-snippet">{h.snippet}</span>
        </button>
      ))}
    </div>
  );
}

export function PdfParsedPanel({ companion, currentPage, onGoToPage, load = api.readContent, initialTab = "page" }: {
  companion: Companion;
  /** 0-based pdf page index (the viewer's own convention). */
  currentPage: number;
  onGoToPage: (pageIdx0: number) => void;
  /** Injectable for the harness — the panel never cares where content
   *  came from (the ConceptPanel convention). */
  load?: ContentLoader;
  initialTab?: "page" | "concepts" | "search";
}) {
  const [tab, setTab] = useState<"page" | "concepts" | "search">(initialTab);
  // The concepts DB may span several parsed halves (KollerFriedman I+II) —
  // merge their `_concepts` rows behind ConceptPanel's injectable loader.
  const conceptLoad = useMemo(() => async (_id: string) => {
    const all: unknown[] = [];
    for (const s of companion.parsed) {
      try {
        const raw = await load(`${s.node}_concepts`);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && Array.isArray(parsed.items)) all.push(...parsed.items);
      } catch { /* one half missing is not fatal */ }
    }
    return all.length ? JSON.stringify({ items: all }) : null;
  }, [companion, load]);

  return (
    <div className="pdf-parsed-panel">
      <div className="pdf-sidebar-tabs">
        <button className={`pdf-sidebar-tab${tab === "page" ? " active" : ""}`} onClick={() => setTab("page")} type="button">This page</button>
        <button className={`pdf-sidebar-tab${tab === "concepts" ? " active" : ""}`} onClick={() => setTab("concepts")} type="button">Concepts</button>
        <button className={`pdf-sidebar-tab${tab === "search" ? " active" : ""}`} onClick={() => setTab("search")} type="button">Search</button>
      </div>
      {tab === "page" && <PageSlice companion={companion} page1={currentPage + 1} load={load} />}
      {tab === "concepts" && <ConceptPanel nodeId={companion.parsed[0]?.node ?? ""} load={conceptLoad} />}
      {tab === "search" && <ParsedSearch companion={companion} onGoToPage={onGoToPage} load={load} />}
    </div>
  );
}
