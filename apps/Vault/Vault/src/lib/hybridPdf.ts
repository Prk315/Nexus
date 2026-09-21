// Pure half of the hybrid reader: the PDF is the VISUAL surface (the book as
// the author laid it out) and the parsed node is the DATA layer under it —
// selectable text, KaTeX with copyable latex, the concepts database, search.
// This module maps between the two spaces. React-free and network-free on
// purpose (the taskTree.ts convention), and kept off the note schema path.
//
// The bridge is built from what the ingest already ships, not from new
// markup: every figure the parser extracted is named
// `{chapterDir}/_page_{N}_...` (N 0-BASED within the chapter's PDF chunk —
// verified: `_page_0_` files exist), and the companion row carries each
// chapter's absolute page range in the master PDF. So every <img> in the
// parsed HTML is a page anchor, and chapter starts anchor the gaps between
// figures.

export interface CompanionSource {
  node: string;
  /** chapterDir -> [firstPdfPage, lastPdfPage], 1-based in the master PDF. */
  chapters: Record<string, [number, number]>;
}
export interface Companion { v: 1; parsed: CompanionSource[] }

/** Null for missing/unusable — same posture as parseShare: absent must be
 *  distinguishable from empty, because "no companion" means the tab should
 *  not render at all, not render empty. */
export function parseCompanion(raw: string | null | undefined): Companion | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.parsed)) return null;
    const parsed: CompanionSource[] = [];
    for (const s of d.parsed) {
      if (!s || typeof s.node !== "string") return null;
      parsed.push({ node: s.node, chapters: s.chapters && typeof s.chapters === "object" ? s.chapters : {} });
    }
    return { v: 1, parsed };
  } catch { return null; }
}

/** Which parsed node covers this PDF page? Sources without chapter ranges
 *  (Kalkulus, ProbRob today) match any page — they are the whole book. */
export function sourceForPage(c: Companion, page: number): CompanionSource | null {
  let fallback: CompanionSource | null = null;
  for (const s of c.parsed) {
    const ranges = Object.values(s.chapters);
    if (!ranges.length) { fallback = fallback ?? s; continue; }
    for (const [a, b] of ranges) if (page >= a && page <= b) return s;
  }
  return fallback;
}

export interface PageAnchor {
  page: number;
  idx: number;
  /** Chapter markers sit exactly on a block boundary; figure anchors point
   *  at an <img> inside a paragraph and must be snapped outward before
   *  slicing. Snapping a marker instead skips the real content between the
   *  previous block and the chapter start. */
  exact?: boolean;
}

/** Page anchors for one parsed node's HTML: every extracted figure plus every
 *  chapter start, sorted by document position with page numbers forced
 *  monotone (a figure placed out of reading order must not fold the map). */
export function buildAnchors(html: string, chapters: Record<string, [number, number]>): PageAnchor[] {
  const anchors: PageAnchor[] = [];
  for (const [dir, [start]] of Object.entries(chapters)) {
    // The ingest stamps each chapter's start with an invisible marker span —
    // the first `/dir/` IMAGE would misattribute everything before it to the
    // previous chapter.
    const idx = html.indexOf(`data-pv-ch="${dir}"`);
    if (idx >= 0) anchors.push({ page: start, idx: Math.max(0, html.lastIndexOf("<", idx)), exact: true });
  }
  const re = /\/([A-Za-z0-9_]+)\/_page_(\d+)_/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const range = chapters[m[1]];
    if (!range) continue;
    const page = range[0] + Number(m[2]);
    anchors.push({ page: Math.min(page, range[1]), idx: Math.max(0, html.lastIndexOf("<", m.index)) });
  }
  anchors.sort((a, b) => a.idx - b.idx);
  let hi = 0;
  for (const a of anchors) {
    if (a.page < hi) a.page = hi; else hi = a.page;
  }
  return anchors;
}

/** Snap an index to the nearest BLOCK boundary at or before it, so a slice
 *  never opens mid-tag or mid-paragraph. */
function snapToBlock(html: string, idx: number): number {
  let best = 0;
  for (const t of ["<p", "<h1", "<h2", "<h3", "<h4", "<ul", "<table", "<blockquote", "<div"]) {
    const i = html.lastIndexOf(t, idx);
    if (i > best) best = i;
  }
  return best;
}

export interface PageSlice { html: string; from: number; to: number }

/** The parsed HTML covering one PDF page — bounded by the anchors around it.
 *  Figure density decides the grain: where figures are dense this is a page,
 *  in a figureless stretch it is the whole run between anchors, and `from`/
 *  `to` say which pages the slice actually spans so the UI never claims more
 *  precision than the map has. */
export function sliceForPage(html: string, anchors: PageAnchor[], page: number): PageSlice | null {
  if (!html) return null;
  if (!anchors.length) return { html, from: NaN, to: NaN };
  let lo: PageAnchor | null = null, hiA: PageAnchor | null = null;
  for (const a of anchors) {
    if (a.page <= page && (!lo || a.idx > lo.idx)) lo = a;
    if (a.page > page && (!hiA || a.idx < hiA.idx) && (!lo || a.idx > lo.idx)) hiA = a;
  }
  const startIdx = lo ? (lo.exact ? lo.idx : snapToBlock(html, lo.idx)) : 0;
  const endIdx = hiA ? (hiA.exact ? hiA.idx : snapToBlock(html, hiA.idx)) : html.length;
  if (endIdx <= startIdx) return { html: "", from: page, to: page };
  return {
    html: html.slice(startIdx, endIdx),
    from: lo ? lo.page : anchors[0].page - 1,
    to: hiA ? hiA.page - 1 : anchors[anchors.length - 1].page,
  };
}

/** PDF page for a character position in the parsed HTML — the search half of
 *  the bridge: find text in the parsed layer, land on the printed page. */
export function pageOfIndex(anchors: PageAnchor[], idx: number): number | null {
  if (!anchors.length) return null;
  let page = anchors[0].page;
  for (const a of anchors) {
    if (a.idx <= idx) page = a.page; else break;
  }
  return page;
}
