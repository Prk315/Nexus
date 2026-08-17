/**
 * ReferencePanel — the "formelsamling": a floating circular button on the
 * right edge of the Learn path that opens a right-side drawer listing every
 * formal statement (sætninger, definitioner, lemmaer, korollarer, identiteter,
 * objekter …) from the units the user has unlocked, so a previously learned
 * theorem can be looked up the moment it's needed again.
 *
 * Design notes (why it is shaped this way):
 *
 * 1. ZERO extra fetches. `PathPanel` already loads every content-bearing
 *    unit's JSON into `contentByUnit` for its meta lines and node gating —
 *    the library is a pure derivation over those same theory boxes. It
 *    receives `path`/`contentByUnit`/`unlockedUnitIds` as props rather than
 *    re-fetching, and recomputes only when they change.
 *
 * 2. Classification is TITLE-first, `kind`-fallback. The content schema's
 *    `TheoryKind` is only definition|theorem|remark, but titles carry the
 *    real taxonomy ("Sætning 5.2", "Korollar 3.9", "Lemma 6.3.6"). A
 *    korollar's `kind` is "theorem", so kind alone would flatten the list —
 *    the title prefix decides the group, and `kind` only catches boxes with
 *    free-form titles ("Rank", "Matrixproduktet"), which land in "Objekter &
 *    begreber" (definition-kind) or "Bemærkninger" (remark-kind). English
 *    prefixes (Theorem/Corollary) are matched too for the DBMS course.
 *
 * 3. Sorted by the statement's OWN number ("5.2" < "5.10" < "6.3.6"),
 *    compared segment-wise numerically — string sort would put 5.10 before
 *    5.2. Unnumbered entries follow, alphabetically.
 *
 * 4. Only UNLOCKED units contribute ("tidligere lærte" — plus the frontier
 *    unit, whose theory is already viewable). Locked units' theorems would
 *    spoil upcoming material and are simply absent, not greyed.
 *
 * 5. The button and drawer live at z-40 — deliberately UNDER the z-50
 *    session overlays (Player/Challenge/Socratic/AggregateTest), so the
 *    library is unreachable mid-session. A test whose questions are drawn
 *    from these very statements must not have the answer sheet floating
 *    next to it.
 */

import { useEffect, useMemo, useState } from "react";
import type { PathUnit, TheoryBox, UnitContent } from "./types";
import { Markdown } from "./Markdown";
import { useLensTokens } from "./player/tokens";

interface RefEntry {
  box: TheoryBox;
  /** Source unit's code ("LA 3 · U2") — rendered as the row's origin chip. */
  unitCode: string;
  /** Spine order of the source unit — tiebreak so equal titles dedupe to
   * their earliest appearance. */
  unitIdx: number;
  group: GroupKey;
  /** Parsed statement number ("6.3.6" -> [6,3,6]), empty when unnumbered. */
  num: number[];
}

type GroupKey =
  | "saetninger"
  | "definitioner"
  | "lemmaer"
  | "korollarer"
  | "identiteter"
  | "algoritmer"
  | "objekter"
  | "bemaerkninger";

const GROUP_ORDER: GroupKey[] = [
  "saetninger",
  "definitioner",
  "lemmaer",
  "korollarer",
  "identiteter",
  "algoritmer",
  "objekter",
  "bemaerkninger",
];

const GROUP_LABEL: Record<GroupKey, string> = {
  saetninger: "Sætninger",
  definitioner: "Definitioner",
  lemmaer: "Lemmaer",
  korollarer: "Korollarer",
  identiteter: "Identiteter",
  algoritmer: "Algoritmer & metoder",
  objekter: "Objekter & begreber",
  bemaerkninger: "Bemærkninger",
};

function classify(box: TheoryBox): GroupKey {
  const t = box.title.trim().toLowerCase();
  if (/^(sætning|saetning|theorem)\b/.test(t)) return "saetninger";
  if (/^definition\b/.test(t)) return "definitioner";
  if (/^lemma\b/.test(t)) return "lemmaer";
  if (/^(korollar|corollary)\b/.test(t)) return "korollarer";
  if (/identitet/.test(t) || /identity/.test(t)) return "identiteter";
  if (/^(bemærkning|bemaerkning|remark)\b/.test(t)) return "bemaerkninger";
  if (/^(algoritme|algorithm|metode|proceduren?)\b/.test(t)) return "algoritmer";
  if (/^(notation|objekt)\b/.test(t)) return "objekter";
  if (box.kind === "theorem") return "saetninger";
  if (box.kind === "remark") return "bemaerkninger";
  return "objekter";
}

function parseNum(title: string): number[] {
  const m = title.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1].split(".").map((s) => parseInt(s, 10)) : [];
}

/** Segment-wise numeric compare; unnumbered ([]) sorts after numbered. */
function compareEntries(a: RefEntry, b: RefEntry): number {
  if (a.num.length && b.num.length) {
    const n = Math.max(a.num.length, b.num.length);
    for (let i = 0; i < n; i++) {
      const d = (a.num[i] ?? -1) - (b.num[i] ?? -1);
      if (d !== 0) return d;
    }
    return a.box.title.localeCompare(b.box.title, "da");
  }
  if (a.num.length) return -1;
  if (b.num.length) return 1;
  return a.box.title.localeCompare(b.box.title, "da");
}

export function ReferencePanel({
  path,
  contentByUnit,
  unlockedUnitIds,
}: {
  path: PathUnit[] | null;
  contentByUnit: Map<number, UnitContent>;
  unlockedUnitIds: Set<number>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const LENS = useLensTokens();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = useMemo(() => {
    if (!path) return [] as Array<[GroupKey, RefEntry[]]>;
    const entries: RefEntry[] = [];
    const seenTitles = new Set<string>();
    const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);
    for (const pu of sorted) {
      if (!unlockedUnitIds.has(pu.unit.unit_id)) continue;
      const content = contentByUnit.get(pu.unit.unit_id);
      if (!content) continue;
      for (const box of content.theory) {
        // Same statement restated in a later unit dedupes to its first
        // appearance — keyed on the normalized title, which is unique for
        // numbered statements ("Sætning 5.2") and harmless for free-form
        // ones (an identically titled box IS the same object).
        const key = box.title.trim().toLowerCase();
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        entries.push({
          box,
          unitCode: pu.unit.code,
          unitIdx: pu.unit.idx,
          group: classify(box),
          num: parseNum(box.title),
        });
      }
    }
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) => e.box.title.toLowerCase().includes(q) || e.box.statement_md.toLowerCase().includes(q)
        )
      : entries;
    const byGroup = new Map<GroupKey, RefEntry[]>();
    for (const e of filtered) {
      const list = byGroup.get(e.group) ?? [];
      list.push(e);
      byGroup.set(e.group, list);
    }
    for (const list of byGroup.values()) list.sort(compareEntries);
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!] as [GroupKey, RefEntry[]]);
  }, [path, contentByUnit, unlockedUnitIds, query]);

  const totalCount = useMemo(() => groups.reduce((n, [, list]) => n + list.length, 0), [groups]);

  if (!path) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Åbn formelsamlingen"
          title="Formelsamling"
          className="fixed right-3 top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#1A1A24] ring-1 ring-black/10 shadow-[0_2px_12px_rgba(0,0,0,0.10)] transition hover:ring-indigo-400/60 hover:shadow-[0_0_16px_-4px_rgba(99,102,241,0.5)] md:right-6"
        >
          {/* Open-book glyph — inline so it needs no asset pipeline. */}
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 6.5C10.5 5 8.2 4.2 5.5 4.2c-1 0-1.9.1-2.5.3v14.3c.6-.2 1.5-.3 2.5-.3 2.7 0 5 .8 6.5 2.3 1.5-1.5 3.8-2.3 6.5-2.3 1 0 1.9.1 2.5.3V4.5c-.6-.2-1.5-.3-2.5-.3-2.7 0-5 .8-6.5 2.3z" />
            <path d="M12 6.5v14.3" />
          </svg>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-black/[0.08] bg-[#F6F5F1] shadow-[-8px_0_32px_rgba(0,0,0,0.12)] animate-[learn-overlay_.22s_ease-out] sm:w-[420px]">
            <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold tracking-tight text-[#1A1A24]">Formelsamling</div>
                <div className="text-[11px] text-[#6E6E78]">
                  {totalCount} {totalCount === 1 ? "resultat" : "opslag"} · fra dine oplåste lektioner
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Luk"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#6E6E78] ring-1 ring-black/10 transition hover:bg-black/[0.04]"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-black/[0.06] px-4 py-2.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Søg i sætninger, definitioner …"
                className="w-full rounded-lg bg-white px-3 py-2 text-sm text-[#1A1A24] ring-1 ring-black/10 outline-none placeholder:text-[#6E6E78]/60 focus:ring-indigo-400/60"
              />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-8">
              {groups.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-[#6E6E78]">
                  {query.trim() ? "Ingen opslag matcher søgningen." : "Ingen opslag endnu — lås en lektion op først."}
                </div>
              )}
              {groups.map(([group, list]) => (
                <div key={group}>
                  <div className="sticky top-0 z-10 bg-[#F6F5F1]/95 px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78] backdrop-blur">
                    {GROUP_LABEL[group]} · {list.length}
                  </div>
                  {list.map((e) => {
                    const key = `${e.group}:${e.box.title}:${e.unitIdx}`;
                    const expanded = expandedKey === key;
                    const lens = e.box.perspective ? LENS[e.box.perspective] : null;
                    return (
                      <div
                        key={key}
                        className="mx-1 mb-1.5 overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
                      >
                        <button
                          onClick={() => setExpandedKey(expanded ? null : key)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1A1A24]">
                            {e.box.title}
                          </span>
                          {lens && (
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${lens.chip}`}>
                              {lens.label}
                            </span>
                          )}
                          <span className="shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] text-[#6E6E78]">
                            {e.unitCode}
                          </span>
                          <span className={`shrink-0 text-[#6E6E78]/60 transition-transform ${expanded ? "rotate-90" : ""}`}>
                            ›
                          </span>
                        </button>
                        {expanded && (
                          <div className="border-t border-black/[0.05] px-3 py-3">
                            <Markdown className="text-[13px]">{e.box.statement_md}</Markdown>
                            {e.box.translations &&
                              Object.entries(e.box.translations).map(([l, md]) =>
                                md && LENS[l] ? (
                                  <div key={l} className="mt-2.5 rounded-lg bg-black/[0.025] px-2.5 py-2">
                                    <span className={`mb-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${LENS[l].chip}`}>
                                      {LENS[l].label}
                                    </span>
                                    <Markdown className="text-[12px]">{md}</Markdown>
                                  </div>
                                ) : null
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
