/**
 * referenceData.ts — the Formelsamling inventory derivation, extracted from
 * `ReferencePanel.tsx` (2026-08-18) because `GeneralproveSession` builds its
 * card tray from the same theory-box inventory. Pure and React-free (the
 * `timetracker/coverage.ts` precedent): the panel and the canvas both call
 * these and render the result their own way.
 *
 * Behavioral contract (any change here changes BOTH surfaces):
 *
 * 1. Order of operations is collect (spine-sorted → locked skipped → absent
 *    content skipped → title-deduped, first appearance wins) → filter → group
 *    → sort within group. Filtering BEFORE grouping is what keeps a searched
 *    group's header count correct.
 * 2. Classification is TITLE-first with `kind` fallback; the regex list and
 *    its order are load-bearing (a korollar's `kind` is `"theorem"`, so kind
 *    alone would flatten the list).
 * 3. `compareRefEntries` sorts numbered before unnumbered and falls back to
 *    `localeCompare(…, "da")`.
 */

import type { PathUnit, TheoryBox, UnitContent } from "./types";

export type RefGroupKey =
  | "saetninger"
  | "definitioner"
  | "lemmaer"
  | "korollarer"
  | "identiteter"
  | "algoritmer"
  | "objekter"
  | "bemaerkninger";

export interface RefEntry {
  box: TheoryBox;
  /** Source unit's code ("LA 3 · U2") — rendered as the row's origin chip. */
  unitCode: string;
  /** Spine order of the source unit — tiebreak so equal titles dedupe to
   * their earliest appearance. */
  unitIdx: number;
  group: RefGroupKey;
  /** Parsed statement number ("6.3.6" -> [6,3,6]), empty when unnumbered. */
  num: number[];
}

export const REF_GROUP_ORDER: RefGroupKey[] = [
  "saetninger",
  "definitioner",
  "lemmaer",
  "korollarer",
  "identiteter",
  "algoritmer",
  "objekter",
  "bemaerkninger",
];

export const REF_GROUP_LABEL: Record<RefGroupKey, string> = {
  saetninger: "Sætninger",
  definitioner: "Definitioner",
  lemmaer: "Lemmaer",
  korollarer: "Korollarer",
  identiteter: "Identiteter",
  algoritmer: "Algoritmer & metoder",
  objekter: "Objekter & begreber",
  bemaerkninger: "Bemærkninger",
};

/** 3-letter tray/card chip per group. Canvas-only; ReferencePanel ignores it. */
export const REF_GROUP_CHIP: Record<RefGroupKey, string> = {
  saetninger: "SÆT",
  definitioner: "DEF",
  lemmaer: "LEM",
  korollarer: "KOR",
  identiteter: "IDE",
  algoritmer: "ALG",
  objekter: "OBJ",
  bemaerkninger: "BEM",
};

export function classifyTheoryBox(box: TheoryBox): RefGroupKey {
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

export function parseStatementNumber(title: string): number[] {
  const m = title.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1].split(".").map((s) => parseInt(s, 10)) : [];
}

/** Segment-wise numeric compare; unnumbered ([]) sorts after numbered. */
export function compareRefEntries(a: RefEntry, b: RefEntry): number {
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

/** The deduped, spine-ordered inventory. Returns [] when path is null. */
export function collectReferenceEntries(
  path: PathUnit[] | null,
  contentByUnit: Map<number, UnitContent>,
  unlockedUnitIds: Set<number>
): RefEntry[] {
  if (!path) return [];
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
        group: classifyTheoryBox(box),
        num: parseStatementNumber(box.title),
      });
    }
  }
  return entries;
}

/** Case-insensitive substring over title + statement_md. Empty query returns
 * the input array itself (same reference), so memo consumers can skip work. */
export function filterRefEntries(entries: RefEntry[], query: string): RefEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.box.title.toLowerCase().includes(q) || e.box.statement_md.toLowerCase().includes(q)
  );
}

/** Group + sort within group; only non-empty groups, in REF_GROUP_ORDER. */
export function groupRefEntries(entries: RefEntry[]): Array<[RefGroupKey, RefEntry[]]> {
  const byGroup = new Map<RefGroupKey, RefEntry[]>();
  for (const e of entries) {
    const list = byGroup.get(e.group) ?? [];
    list.push(e);
    byGroup.set(e.group, list);
  }
  for (const list of byGroup.values()) list.sort(compareRefEntries);
  return REF_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!] as [RefGroupKey, RefEntry[]]);
}

/** Stable identity — byte-identical to ReferencePanel's original React key. */
export function refEntryKey(e: RefEntry): string {
  return `${e.group}:${e.box.title}:${e.unitIdx}`;
}
