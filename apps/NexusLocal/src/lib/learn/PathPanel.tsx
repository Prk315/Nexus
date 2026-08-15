/**
 * The path spine — DESIGN.md §2. One vertical rail, 28 units grouped into
 * chapters (`LA 0`…`LA 6`, derived from `lr_unit.code`'s `"LA n · Um"` prefix
 * since `lr_unit.title` is empty in the DB today), a gradient fill that climbs
 * as units are mastered, and a tap-to-open Player overlay.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. This panel now
 * renders on `#F6F5F1` paper (painted by `LearnPage` in `index.tsx`), not the
 * app's dark `#0a0a0f`. Ink/muted tokens replace every `white/NN` opacity
 * step; see the v2 token table in DESIGN.md for the recipe.
 *
 * ── Contract gaps vs. DESIGN.md, resolved pragmatically ─────────────────────
 *
 * 1. §2.4 assumes the row meta line ("8 bokse · 14 øvelser · 95 min") is free
 *    because "fetchPath() already knows which units have content". The actual
 *    `api.fetchPath()` only returns `hasContent`/`contentStatus`, not counts —
 *    it does one query across all units, not per-unit content. So this file
 *    does a second pass: after `fetchPath()` resolves, it calls
 *    `api.fetchUnitContent(unitId)` in parallel for every unit where
 *    `hasContent` is true (23 of 28 today) to get `title`/`theory.length`/
 *    drill counts/`est_minutes`. Still zero *extra round trips per row* the
 *    user has to wait on serially, just not the single-request "free" the
 *    design assumed. The meta line renders as `unit.code` alone until that
 *    resolves, then upgrades in place.
 * 2. §2.3's `in_progress` node wants an SVG ring dasharray driven by a
 *    "drills solved" ratio for the unit. There is no api.ts surface for that
 *    (it would need `lr_attempt_log` cross-referenced against that unit's
 *    drill ids, which requires content already loaded and a log fetch this
 *    file has no function for) — inventing a fake fraction would be worse
 *    than not showing one. `in_progress` renders a full ring at reduced
 *    opacity plus a pulsing core dot instead of a partial dasharray.
 * 3. Real data (checked 2026-08-07): unit 1 is `progress: "mastered"` but has
 *    **no** `lr_unit_content` row. Per DESIGN.md's STATUS table, "no content
 *    at all" always renders as `no_content` (dashed, not tappable) — that
 *    wins over the progress flag for the node's *visual status*, since there
 *    is nothing to open. The header ring's `mastered / total` count and the
 *    rail's earned-fill height still use the real `lr_unit_progress` row
 *    (ground truth for "how far along"), independent of what the node looks
 *    like — so the fill can end at a `no_content`-styled node.
 *
 * ── Proof side-paths (LEARN_PLAN.md "Proof side-paths", pinned 2026-08-10) ──
 *
 * When a unit masters, its proof unit (if any exists for that `parent_unit_id`)
 * unlocks as a compact side node branching off the unit row — a dashed
 * connector to a small "∴" glyph, muted until tapped, filled with a check once
 * `lr_proof_progress.status = "completed"`. A unit with no proof gets nothing:
 * no empty slot, no placeholder — the reward only appears when it exists.
 * A unit that is *not* mastered renders no side node at all, even if a proof
 * row exists for it — "locked" is never a visible state here, it's simply
 * absence, so proofs read as rewards rather than one more locked thing on the
 * spine. Tapping always opens the Player (even with no content row yet — it
 * renders its own quiet "ikke klar endnu" state); PathPanel's only job on tap
 * is the `lr_proof_progress` "in_progress" upsert on first open (§ below).
 *
 * ── Eksamensværksted side-paths (LEARN_PLAN.md "Eksamensværksted", pinned
 * 2026-08-10) ────────────────────────────────────────────────────────────────
 *
 * The same `lr_proof_*` trio also carries `kind: "workshop"` rows — chapter-end
 * exam-technique units. Unlike a `kind: "proof"` row (∴, hangs off its own
 * `parent_unit_id`'s row, unlocks on THAT unit mastering), a workshop's
 * `parent_unit_id` is the chapter's LAST unit, and it unlocks on the
 * *chapter's* mastery rule — the same "≥1 unit mastered" gate the ⚡
 * `ChapterChallengeNode` checkpoint already uses, reusing `masteredInChapter`
 * rather than re-deriving it. It renders as a full-width sibling row right
 * next to the checkpoint, not indented under a unit like a proof — a distinct
 * "§" glyph (never ∴, that reads as proof-specific) with its own amber→fuchsia
 * gradient accent once completed. `proofsByParentUnit` (below) is filtered to
 * `kind: "proof"` so workshop rows never also render as a ∴ side node.
 *
 * ── Flashcard deck nodes (LEARN_PLAN.md "Flashcard decks", corrected
 * placement 2026-08-12) ──────────────────────────────────────────────────
 *
 * Decks were built yesterday as steps *inside* the unit Player
 * (`entryDeck`/`exitDeck`, first/last in the flow). Per explicit correction
 * they are now their own compact path nodes bracketing a unit's row: the
 * entry deck ("Kend sætningerne") directly above `UnitRow`, the exit deck
 * ("Sig og anvend dem") directly below it — see `DeckNode` below. Both open
 * `Player`'s new `deckSession` mode rather than the full unit Player.
 *
 * Presence needs no extra query: `contentByUnit` (populated below, same
 * `fetchUnitContent` pass §1 already does for the meta line) already carries
 * the full `UnitContent`, `flashcards` included — a unit whose newest
 * content has no `flashcards` key, or empty entry/exit arrays, renders no
 * deck node at all, independently per deck (a unit can have an entry deck
 * with no exit deck or vice versa, though authoring practice is 1:1 today).
 *
 * Unlock rule (mirrors each deck's own gate in `Player.tsx`'s old in-flow
 * placement, just re-homed to the node's tap target): entry is tappable
 * whenever the unit itself is available/in_progress/mastered — same
 * threshold as `UnitRow`'s own `opensPlayer`; exit is tappable only once the
 * unit is `mastered` (it tests application AFTER the module, not alongside
 * it). Both nodes still RENDER earlier than that (dashed/dim, not tappable)
 * so the spine previews what's coming, matching how a locked future unit row
 * is visible-but-inert rather than hidden — unlike `ProofNode`, which is a
 * reward and stays absent until earned.
 *
 * Completion ("visually complete when every entry/exit card has an
 * attempt"): one batched `fetchSolvedDrillIds` call over every deck card id
 * across every unit in the course (`deckSolvedIds` below) — the exact same
 * continuity signal `Player`'s deckSession/unit modes resume from, just read
 * here for the checkmark instead of a resume index. One extra round trip for
 * the whole panel, not one per node.
 *
 * ── Socratic dialogue nodes (LEARN_PLAN.md "Socratic dialogue nodes",
 * pinned 2026-08-15) ─────────────────────────────────────────────────────
 *
 * Same `lr_proof_*` trio, `kind: "socratic"` — grouped by `parent_unit_id`
 * exactly like `proofsByParentUnit` (`socraticByParentUnit` below), same
 * per-unit-mastery gate (only rendered once the parent's `status ===
 * "mastered"` — "locked" is absence here too, not a visible state). Placed
 * as a satellite node directly BELOW the unit's exit `DeckNode` (or the
 * `UnitRow` itself when the unit has no exit deck) — a "?" glyph in a
 * gradient-tinted disc, sized and shaped like `DeckNode` (a satellite of the
 * unit, not a peer stop like `ProofNode`'s indented ∴ branch), swapping to
 * the shared "✓ done" language once `lr_proof_progress.status ===
 * "completed"`. Tapping opens `SocraticSession` (never `Player` — that
 * file's content is `SocraticScript`-shaped, not `UnitContent`-shaped) via
 * `openSocratic`, which reuses the exact same "flip available → in_progress
 * on first open, never downgrade a completed session" guard `openProof`
 * uses — same table, same write.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fetchPath,
  fetchProofContent,
  fetchProofUnits,
  fetchSolvedDrillIds,
  fetchUnitContent,
  setProofProgress,
  setUnitProgress,
} from "./api";
import type { PathUnit, ProofUnitEntry, ProofUnitKind, UnitContent } from "./types";
import { useCourse } from "./CourseContext";
import { CourseSwitcher } from "./CourseSwitcher";
import { Player } from "./Player";
import { ChallengeSession } from "./ChallengeSession";
import { SocraticSession } from "./SocraticSession";

type DisplayStatus = "locked" | "available" | "in_progress" | "mastered" | "no_content";

const STATUS_NODE: Record<DisplayStatus, string> = {
  locked: "bg-black/[0.04] ring-1 ring-black/10",
  available: "bg-indigo-50 ring-1 ring-indigo-400/60 shadow-[0_0_16px_-6px_rgba(99,102,241,0.4)]",
  in_progress: "bg-white ring-1 ring-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
  mastered: "bg-gradient-to-br from-indigo-500 to-fuchsia-600 ring-1 ring-black/10 shadow-[0_0_18px_-6px_rgba(217,70,239,0.5)]",
  no_content: "bg-transparent ring-1 ring-black/10 ring-dashed",
};

const STATUS_GLYPH: Record<DisplayStatus, string> = {
  locked: "◇",
  available: "◆",
  in_progress: "◆",
  mastered: "✓",
  no_content: "·",
};

const STATUS_GLYPH_TEXT: Record<DisplayStatus, string> = {
  locked: "text-[#6E6E78]/45",
  available: "text-indigo-600",
  in_progress: "text-[#1A1A24]",
  mastered: "text-white",
  no_content: "text-[#6E6E78]/45",
};

const STATUS_ROW_TEXT: Record<DisplayStatus, string> = {
  locked: "text-[#6E6E78]/55",
  available: "text-[#1A1A24]/85",
  in_progress: "text-[#1A1A24]",
  mastered: "text-[#1A1A24]/90",
  no_content: "text-[#6E6E78]/45",
};

function chapterOf(code: string): string {
  const i = code.indexOf("·");
  return i === -1 ? code.trim() : code.slice(0, i).trim();
}

export function PathPanel() {
  const { course } = useCourse();
  const [path, setPath] = useState<PathUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentByUnit, setContentByUnit] = useState<Map<number, UnitContent>>(new Map());
  const [expandedLocked, setExpandedLocked] = useState<number | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [proofEntries, setProofEntries] = useState<ProofUnitEntry[]>([]);
  const [proofContentByProof, setProofContentByProof] = useState<Map<number, UnitContent>>(new Map());
  const [selectedProofId, setSelectedProofId] = useState<number | null>(null);
  // Which side-unit flavour the currently open Player is showing — threaded
  // into Player's `kind` prop so its header chip/graduation label can read
  // "VÆRKSTED"/"WORKSHOP COMPLETE" for a workshop vs. "BEVIS"/"PROOF COMPLETE"
  // for a proof, without Player having to look this up itself (proof content
  // rows carry no `kind` of their own — only `lr_proof_unit` does).
  const [selectedProofKind, setSelectedProofKind] = useState<ProofUnitKind>("proof");
  // Socratic dialogue node state — see the file-header note. Own overlay
  // (`SocraticSession`, never `Player`), own selected-id state: a socratic
  // side-node's content is script-shaped, not `UnitContent`-shaped.
  const [selectedSocraticProofId, setSelectedSocraticProofId] = useState<number | null>(null);
  // LEARN_PLAN.md's chapter-checkpoint pilot (2026-08-10) — a ⚡ Lynudfordring
  // node after a chapter's last unit row, opening `ChallengeSession` scoped
  // to that chapter's code prefix (e.g. "LA 2"). See `ChapterChallengeNode`.
  const [selectedChallengeChapter, setSelectedChallengeChapter] = useState<string | null>(null);
  // Flashcard-deck node state (see the file-header note above). `deckSession`
  // mirrors `Player`'s own prop shape so it can be spread straight in.
  const [selectedDeckSession, setSelectedDeckSession] = useState<{ unitId: number; deck: "entry" | "exit" } | null>(
    null
  );
  // Every deck card id this user has ≥1 `lr_attempt_log` row for, across
  // every unit in the course — one batched query per load, not per node.
  const [deckSolvedIds, setDeckSolvedIds] = useState<Set<string>>(new Set());
  const [reloadNonce, setReloadNonce] = useState(0);
  const [railHeightPx, setRailHeightPx] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Load the spine + every proof unit (regardless of parent mastery — display
  // status is derived below), then fill in per-unit/per-proof content
  // (title/counts) for whatever has any — see contract-gap note #1 above,
  // which applies identically to proof content.
  useEffect(() => {
    let cancelled = false;
    // Reset to the loading state immediately on a course switch — otherwise
    // the previous course's units stay on screen (and tappable) until the
    // new course's fetch resolves.
    setPath(null);
    setContentByUnit(new Map());
    setDeckSolvedIds(new Set());
    (async () => {
      try {
        setError(null);
        const [p, proofs] = await Promise.all([fetchPath(course.courseId), fetchProofUnits()]);
        if (cancelled) return;
        setPath(p);
        setProofEntries(proofs);

        const withContent = p.filter((pu) => pu.hasContent);
        const proofsWithContent = proofs.filter((pe) => pe.hasContent);
        const [unitPairs, proofPairs] = await Promise.all([
          Promise.all(
            withContent.map(async (pu) => {
              const row = await fetchUnitContent(pu.unit.unit_id).catch(() => null);
              return [pu.unit.unit_id, row?.content ?? null] as const;
            })
          ),
          Promise.all(
            proofsWithContent.map(async (pe) => {
              const row = await fetchProofContent(pe.proofUnit.proof_id).catch(() => null);
              return [pe.proofUnit.proof_id, row?.content ?? null] as const;
            })
          ),
        ]);
        if (cancelled) return;
        const map = new Map<number, UnitContent>();
        for (const [id, content] of unitPairs) if (content) map.set(id, content);
        setContentByUnit(map);

        const proofMap = new Map<number, UnitContent>();
        for (const [id, content] of proofPairs) if (content) proofMap.set(id, content);
        setProofContentByProof(proofMap);

        // Deck-node completion: every entry+exit flashcard id across every
        // unit just loaded, resolved in one batched `fetchSolvedDrillIds`
        // call — see the file-header note. Skipped entirely when nothing in
        // this course has any deck yet.
        const deckCardIds = Array.from(map.values()).flatMap((c) => [
          ...(c.flashcards?.entry.map((fc) => fc.id) ?? []),
          ...(c.flashcards?.exit.map((fc) => fc.id) ?? []),
        ]);
        if (deckCardIds.length > 0) {
          const solved = await fetchSolvedDrillIds(deckCardIds).catch(() => new Set<string>());
          if (!cancelled) setDeckSolvedIds(solved);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, course.courseId]);

  // proof_id[] per parent unit — a unit renders every proof branching off it
  // once mastered (pilot data is 1:1, the join doesn't assume it). Workshop
  // rows are excluded here — they render at chapter-end instead, see below.
  const proofsByParentUnit = useMemo(() => {
    const map = new Map<number, ProofUnitEntry[]>();
    for (const pe of proofEntries) {
      if (pe.proofUnit.kind !== "proof") continue;
      const list = map.get(pe.proofUnit.parent_unit_id) ?? [];
      list.push(pe);
      map.set(pe.proofUnit.parent_unit_id, list);
    }
    return map;
  }, [proofEntries]);

  // proof_id[] per parent unit for `kind: "socratic"` rows — same shape and
  // gate as `proofsByParentUnit` above, just filtered to the dialogue kind.
  const socraticByParentUnit = useMemo(() => {
    const map = new Map<number, ProofUnitEntry[]>();
    for (const pe of proofEntries) {
      if (pe.proofUnit.kind !== "socratic") continue;
      const list = map.get(pe.proofUnit.parent_unit_id) ?? [];
      list.push(pe);
      map.set(pe.proofUnit.parent_unit_id, list);
    }
    return map;
  }, [proofEntries]);

  // Workshop entries grouped by the chapter they belong to — derived from
  // their `parent_unit_id` (the chapter's last unit) via that unit's own
  // `lr_unit.code` prefix, same `chapterOf()` split `ChapterHeader` uses.
  const workshopsByChapter = useMemo(() => {
    const map = new Map<string, ProofUnitEntry[]>();
    if (!path) return map;
    const codeByUnitId = new Map<number, string>();
    for (const pu of path) codeByUnitId.set(pu.unit.unit_id, pu.unit.code);
    for (const pe of proofEntries) {
      if (pe.proofUnit.kind !== "workshop") continue;
      const parentCode = codeByUnitId.get(pe.proofUnit.parent_unit_id);
      if (!parentCode) continue;
      const chapter = chapterOf(parentCode);
      const list = map.get(chapter) ?? [];
      list.push(pe);
      map.set(chapter, list);
    }
    return map;
  }, [proofEntries, path]);

  // Status per unit + the label of "what to master first" for locked rows +
  // the ground-truth mastered count for the header ring / rail fill.
  const { statusByUnit, prevLabelByUnit, masteredCount } = useMemo(() => {
    const statusMap = new Map<number, DisplayStatus>();
    const prevLabelMap = new Map<number, string>();
    let mastered = 0;
    if (!path) return { statusByUnit: statusMap, prevLabelByUnit: prevLabelMap, masteredCount: 0 };

    const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);
    let prevMastered = true; // the first unit on the spine is never locked
    let prevLabel = "";
    for (const pu of sorted) {
      let status: DisplayStatus;
      if (!pu.hasContent) status = "no_content";
      else if (pu.progress === "mastered") status = "mastered";
      else if (pu.progress === "in_progress") status = "in_progress";
      else status = prevMastered ? "available" : "locked";

      statusMap.set(pu.unit.unit_id, status);
      prevLabelMap.set(pu.unit.unit_id, prevLabel || pu.unit.code);
      if (pu.progress === "mastered") mastered += 1;
      // Content-less units are deliberate off-pensum scaffold: they can never
      // be opened, so they must be transparent to the unlock chain — the gate
      // walks back to the nearest preceding unit WITH content. Otherwise a
      // scaffold unit (LA 2 · U6) deadlocks every chapter after it.
      if (!pu.hasContent) continue;
      prevMastered = pu.progress === "mastered";
      prevLabel = contentByUnit.get(pu.unit.unit_id)?.title || pu.unit.code;
    }
    return { statusByUnit: statusMap, prevLabelByUnit: prevLabelMap, masteredCount: mastered };
  }, [path, contentByUnit]);

  const total = path?.length ?? 0;

  const chapters = useMemo(() => {
    if (!path) return [] as Array<[string, PathUnit[]]>;
    const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);
    const order: string[] = [];
    const map = new Map<string, PathUnit[]>();
    for (const pu of sorted) {
      const ch = chapterOf(pu.unit.code);
      if (!map.has(ch)) {
        map.set(ch, []);
        order.push(ch);
      }
      map.get(ch)!.push(pu);
    }
    return order.map((ch) => [ch, map.get(ch)!] as [string, PathUnit[]]);
  }, [path]);

  const currentChapterLabel = useMemo(() => {
    if (!path || path.length === 0) return "";
    const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);
    const frontier = sorted.find((pu) => {
      const s = statusByUnit.get(pu.unit.unit_id);
      return s === "available" || s === "in_progress";
    });
    if (frontier) return chapterOf(frontier.unit.code);
    if (sorted.every((pu) => pu.progress === "mastered")) return chapterOf(sorted[sorted.length - 1].unit.code);
    return chapterOf(sorted[0].unit.code);
  }, [path, statusByUnit]);

  // Rail fill: pixel height from the list's top to the vertical centre of the
  // last mastered row, so the gradient climbs to exactly the right node.
  useLayoutEffect(() => {
    if (!path || !listRef.current) {
      setRailHeightPx(0);
      return;
    }
    const sorted = [...path].sort((a, b) => a.unit.idx - b.unit.idx);
    let lastMasteredId: number | null = null;
    for (const pu of sorted) if (pu.progress === "mastered") lastMasteredId = pu.unit.unit_id;
    if (lastMasteredId === null) {
      setRailHeightPx(0);
      return;
    }
    const el = rowRefs.current.get(lastMasteredId);
    if (!el) {
      setRailHeightPx(0);
      return;
    }
    const containerTop = listRef.current.getBoundingClientRect().top;
    const elRect = el.getBoundingClientRect();
    setRailHeightPx(Math.max(0, elRect.top - containerTop + elRect.height / 2));
  }, [path, contentByUnit, expandedLocked]);

  async function practiceAnyway(pu: PathUnit) {
    setExpandedLocked(null);
    // Optimistic: this unit stops being locked immediately, matching
    // DESIGN.md §2.7 point 4 — once opened this way it behaves like any
    // other in_progress unit and the override affordance disappears.
    setPath((prev) =>
      prev ? prev.map((p) => (p.unit.unit_id === pu.unit.unit_id ? { ...p, progress: "in_progress" } : p)) : prev
    );
    setSelectedUnitId(pu.unit.unit_id);
    try {
      await setUnitProgress(pu.unit.unit_id, "in_progress");
    } catch {
      // Best-effort — Player's own writes are the ones that matter for
      // grading; a failed status flip here just means the row re-locks on
      // the next reload, which is a harmless (if mildly annoying) fallback.
    }
  }

  // Opens a proof side-node. The one write this file owns for proofs: flip
  // "available" -> "in_progress" on first open (LEARN_PLAN.md step 5) —
  // guarded so a *completed* proof reopened for review is never downgraded
  // back to in_progress, and an already-in_progress proof isn't re-written
  // pointlessly.
  function openProof(entry: ProofUnitEntry) {
    const proofId = entry.proofUnit.proof_id;
    setSelectedProofId(proofId);
    setSelectedProofKind(entry.proofUnit.kind);
    if (entry.progress !== "available") return;
    setProofEntries((prev) =>
      prev.map((pe) => (pe.proofUnit.proof_id === proofId ? { ...pe, progress: "in_progress" } : pe))
    );
    setProofProgress(proofId, "in_progress").catch(() => {
      // Best-effort, same posture as practiceAnyway above — a failed flip
      // here just means the node reads "available" again on next reload.
    });
  }

  // Opens a socratic side-node. Same table, same guard as `openProof` above —
  // just routed to `selectedSocraticProofId` (-> `SocraticSession`) instead
  // of `selectedProofId` (-> `Player`).
  function openSocratic(entry: ProofUnitEntry) {
    const proofId = entry.proofUnit.proof_id;
    setSelectedSocraticProofId(proofId);
    if (entry.progress !== "available") return;
    setProofEntries((prev) =>
      prev.map((pe) => (pe.proofUnit.proof_id === proofId ? { ...pe, progress: "in_progress" } : pe))
    );
    setProofProgress(proofId, "in_progress").catch(() => {
      // Best-effort, same posture as openProof above.
    });
  }

  return (
    <section className="flex flex-col gap-2 md:gap-3">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="pathGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
      </svg>

      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">
          Learn · {course.title}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <CourseSwitcher />
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            aria-label="Refresh"
            // Visual glyph stays a subtle 28px icon (unchanged), but the tap
            // target itself is expanded to 44px via an invisible pseudo-element
            // rather than growing the icon — DESIGN.md's "phone floor" without
            // making a quiet header affordance visually loud.
            className="relative grid h-7 w-7 place-items-center rounded-lg text-[#6E6E78] before:absolute before:-inset-2 before:content-[''] active:bg-black/[0.05] active:text-[#1A1A24]/80"
          >
            ⟳
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 ring-1 ring-red-500/20">{error}</div>
      )}

      {!path ? (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Loading path…
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:gap-5 md:rounded-2xl md:p-5">
            <HeaderRing mastered={masteredCount} total={total} />
            <div className="min-w-0">
              <div className="text-xs text-[#6E6E78] md:text-sm">
                {masteredCount} / {total} mastered
              </div>
              {currentChapterLabel && (
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-[#6E6E78]/70 md:mt-1 md:text-[11px]">
                  {currentChapterLabel}
                </div>
              )}
            </div>
          </div>

          <div ref={listRef} className="relative flex flex-col md:mt-1">
            <div className="pointer-events-none absolute left-[14px] top-0 bottom-0 w-px bg-black/[0.08]" />
            <div
              className="pointer-events-none absolute left-[14px] top-0 w-px rounded-full bg-gradient-to-b from-indigo-500 to-fuchsia-500 shadow-[0_0_10px_0_rgba(168,85,247,0.45)] transition-[height] duration-700 ease-[cubic-bezier(.16,1,.3,1)]"
              style={{ height: `${railHeightPx}px` }}
            />

            {chapters.map(([chapter, units]) => {
              const masteredInChapter = units.filter((u) => u.progress === "mastered").length;
              return (
                <div key={chapter}>
                  <ChapterHeader chapter={chapter} mastered={masteredInChapter} total={units.length} />
                  {units.map((pu) => {
                    const status = statusByUnit.get(pu.unit.unit_id) ?? "locked";
                    const content = contentByUnit.get(pu.unit.unit_id);
                    // Proof side-nodes only ever appear once the parent has
                    // mastered — "locked" is absence here, not a visible
                    // state (see the file-header note above).
                    const proofs = status === "mastered" ? (proofsByParentUnit.get(pu.unit.unit_id) ?? []) : [];
                    const socratics = status === "mastered" ? (socraticByParentUnit.get(pu.unit.unit_id) ?? []) : [];
                    // Flashcard-deck nodes — see the file-header note. Entry
                    // brackets the row above, exit below; either is simply
                    // absent when its array is empty/missing.
                    const entryCards = content?.flashcards?.entry ?? [];
                    const exitCards = content?.flashcards?.exit ?? [];
                    const unitUnlocked = status === "available" || status === "in_progress" || status === "mastered";
                    return (
                      <div key={pu.unit.unit_id}>
                        {entryCards.length > 0 && (
                          <DeckNode
                            label="Kend sætningerne"
                            cardCount={entryCards.length}
                            solvedCount={entryCards.filter((c) => deckSolvedIds.has(c.id)).length}
                            available={unitUnlocked}
                            onOpen={() => setSelectedDeckSession({ unitId: pu.unit.unit_id, deck: "entry" })}
                          />
                        )}
                        <UnitRow
                          pu={pu}
                          status={status}
                          content={content}
                          draft={pu.contentStatus === "draft"}
                          expanded={expandedLocked === pu.unit.unit_id}
                          lockedReasonLabel={`Låst — mestr ${prevLabelByUnit.get(pu.unit.unit_id) ?? "forrige lektion"} først.`}
                          onToggleExpand={() =>
                            setExpandedLocked((cur) => (cur === pu.unit.unit_id ? null : pu.unit.unit_id))
                          }
                          onOpen={() => setSelectedUnitId(pu.unit.unit_id)}
                          onPracticeAnyway={() => practiceAnyway(pu)}
                          setRowRef={(el) => {
                            if (el) rowRefs.current.set(pu.unit.unit_id, el);
                            else rowRefs.current.delete(pu.unit.unit_id);
                          }}
                        />
                        {exitCards.length > 0 && (
                          <DeckNode
                            label="Sig og anvend dem"
                            cardCount={exitCards.length}
                            solvedCount={exitCards.filter((c) => deckSolvedIds.has(c.id)).length}
                            available={status === "mastered"}
                            onOpen={() => setSelectedDeckSession({ unitId: pu.unit.unit_id, deck: "exit" })}
                          />
                        )}
                        {socratics.map((entry) => (
                          <SocraticNode
                            key={entry.proofUnit.proof_id}
                            entry={entry}
                            title={
                              proofContentByProof.get(entry.proofUnit.proof_id)?.title ||
                              entry.proofUnit.title ||
                              entry.proofUnit.code
                            }
                            onOpen={() => openSocratic(entry)}
                          />
                        ))}
                        {proofs.map((entry) => (
                          <ProofNode
                            key={entry.proofUnit.proof_id}
                            entry={entry}
                            title={
                              proofContentByProof.get(entry.proofUnit.proof_id)?.title ||
                              entry.proofUnit.title ||
                              entry.proofUnit.code
                            }
                            onOpen={() => openProof(entry)}
                          />
                        ))}
                      </div>
                    );
                  })}
                  {/* Checkpoint node — practice only, never a gate: it must not
                      block path progression, so it renders once ANY unit in
                      the chapter has mastered, not once the whole chapter has. */}
                  {masteredInChapter > 0 && (
                    <ChapterChallengeNode chapter={chapter} onOpen={() => setSelectedChallengeChapter(chapter)} />
                  )}
                  {/* Workshop side-node(s) — same "≥1 unit mastered" gate as the
                      checkpoint above, a full-width sibling row, never indented
                      like a ∴ proof (LEARN_PLAN.md "Eksamensværksted"). */}
                  {masteredInChapter > 0 &&
                    (workshopsByChapter.get(chapter) ?? []).map((entry) => (
                      <WorkshopNode
                        key={entry.proofUnit.proof_id}
                        entry={entry}
                        title={
                          proofContentByProof.get(entry.proofUnit.proof_id)?.title ||
                          entry.proofUnit.title ||
                          entry.proofUnit.code
                        }
                        onOpen={() => openProof(entry)}
                      />
                    ))}
                </div>
              );
            })}

            {/* Partial-path horizon — LEARN_PLAN.md "App course support":
                "the DBMS path ends in a 'more to come' horizon (built
                sections only — no ghost units)". A course being built
                incrementally (`!course.complete`) never pretends its last
                authored chapter is the end of the course; it also never
                invents placeholder rows for sections that don't exist in
                `lr_unit` yet — this is the only thing that renders past the
                last real unit. Quiet by design: no glyph on the rail, no
                gradient, just muted ink. */}
            {!course.complete && (
              <div className="relative flex items-center gap-3 pl-1 pt-4 pb-2 md:pt-7">
                <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.03] text-[12px] text-[#6E6E78]/45 ring-1 ring-dashed ring-black/10">
                  ⋯
                </span>
                <span className="text-[11px] italic text-[#6E6E78]/60 md:text-[12px]">
                  More sections on the way
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {selectedUnitId !== null && (
        <Player
          unitId={selectedUnitId}
          onClose={() => {
            setSelectedUnitId(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      )}

      {selectedProofId !== null && (
        <Player
          proofId={selectedProofId}
          kind={selectedProofKind}
          onClose={() => {
            setSelectedProofId(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      )}

      {selectedChallengeChapter !== null && (
        <ChallengeSession chapter={selectedChallengeChapter} onClose={() => setSelectedChallengeChapter(null)} />
      )}

      {selectedDeckSession !== null && (
        <Player
          deckSession={selectedDeckSession}
          onClose={() => {
            setSelectedDeckSession(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      )}

      {selectedSocraticProofId !== null && (
        <SocraticSession
          proofId={selectedSocraticProofId}
          onClose={() => {
            setSelectedSocraticProofId(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function HeaderRing({ mastered, total }: { mastered: number; total: number }) {
  const size = 56;
  const stroke = 5;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(1, mastered / total) : 0;
  const center = size / 2;
  return (
    <svg width={size} height={size} className="shrink-0" aria-hidden>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="url(#pathGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: "stroke-dashoffset 0.7s ease-out" }}
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[#1A1A24] font-mono text-[15px] font-semibold"
      >
        {mastered}
      </text>
    </svg>
  );
}

function ChapterHeader({ chapter, mastered, total }: { chapter: string; mastered: number; total: number }) {
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  return (
    <div className="relative flex items-center gap-2 pl-[14px] pt-4 pb-1 md:gap-3 md:pt-7 md:pb-2">
      <span className="-ml-[14px] w-7 shrink-0 bg-[#F6F5F1] text-center text-[10px] font-semibold tracking-wider text-[#6E6E78]/70 md:text-[11px]">
        {chapter}
      </span>
      <span className="h-[2px] flex-1 overflow-hidden rounded-full bg-black/[0.07]">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-[#6E6E78]/55">
        {mastered}/{total}
      </span>
    </div>
  );
}

function UnitNode({ status, draft }: { status: DisplayStatus; draft: boolean }) {
  return (
    <span
      className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] ${STATUS_NODE[status]}`}
    >
      {status === "in_progress" ? (
        <>
          <svg width="28" height="28" className="absolute inset-0" aria-hidden>
            <circle cx="14" cy="14" r="11" fill="none" stroke="url(#pathGrad)" strokeWidth="3" opacity="0.6" />
          </svg>
          <span className="relative h-1.5 w-1.5 animate-pulse rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600" />
        </>
      ) : (
        <span className={STATUS_GLYPH_TEXT[status]}>{STATUS_GLYPH[status]}</span>
      )}
      {draft && <span className="absolute -top-0.5 -right-0.5 h-[5px] w-[5px] rounded-full bg-amber-500" />}
    </span>
  );
}

function UnitRow({
  pu,
  status,
  content,
  draft,
  expanded,
  lockedReasonLabel,
  onToggleExpand,
  onOpen,
  onPracticeAnyway,
  setRowRef,
}: {
  pu: PathUnit;
  status: DisplayStatus;
  content: UnitContent | undefined;
  draft: boolean;
  expanded: boolean;
  lockedReasonLabel: string;
  onToggleExpand: () => void;
  onOpen: () => void;
  onPracticeAnyway: () => void;
  setRowRef: (el: HTMLDivElement | null) => void;
}) {
  const title = content?.title || pu.unit.code;
  const meta = content
    ? `${pu.unit.code} · ${content.theory.length} bokse · ${content.practice.reduce((n, g) => n + g.drills.length, 0)} øvelser · ${content.est_minutes} min`
    : pu.unit.code;

  const opensPlayer = status === "available" || status === "in_progress" || status === "mastered";
  const opensFold = status === "locked";
  const clickable = opensPlayer || opensFold;

  return (
    <div ref={setRowRef} className="relative">
      <button
        type="button"
        disabled={!clickable}
        aria-expanded={opensFold ? expanded : undefined}
        onClick={opensFold ? onToggleExpand : opensPlayer ? onOpen : undefined}
        className={`group flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left transition-colors md:gap-4 md:py-2.5 ${
          clickable ? "active:bg-black/[0.03] md:hover:bg-black/[0.025]" : "cursor-default"
        }`}
      >
        <UnitNode status={status} draft={draft} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className={`block truncate text-[14px] font-medium md:text-[15px] ${STATUS_ROW_TEXT[status]}`}>
            {title}
          </span>
          <span className="mt-0.5 block text-[10px] text-[#6E6E78]/70 md:text-[11px]">{meta}</span>
        </span>
        {opensPlayer && <span className="pt-1 text-[#6E6E78]/45 group-active:text-[#1A1A24]/60">›</span>}
      </button>

      {status === "locked" && (
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="ml-10 mt-1 mb-1 flex items-center gap-3 text-[11px]">
              <span className="text-[#6E6E78]/60">{lockedReasonLabel}</span>
              <button
                type="button"
                onClick={onPracticeAnyway}
                className="ml-auto flex min-h-[44px] shrink-0 items-center rounded-lg px-3 text-[11px] text-[#6E6E78] ring-1 ring-black/10 active:bg-black/[0.05] active:text-[#1A1A24]/80"
              >
                Øv alligevel →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Deck node visual states — deliberately restrained relative to `STATUS_NODE`
// above: the disc is smaller (20px vs. 28px) and every tone here is either a
// dashed outline or a soft tint, never `STATUS_NODE.mastered`'s solid
// gradient+glow. A deck is a satellite of its unit, not a peer stop on the
// spine, and the node has to read that way even before you notice the size
// difference.
const DECK_NODE_TONE: Record<"locked" | "available" | "complete", { disc: string; text: string; glyph: string }> = {
  locked: {
    disc: "bg-transparent ring-1 ring-dashed ring-black/[0.14] text-[#6E6E78]/30",
    text: "text-[#6E6E78]/35",
    glyph: "▤",
  },
  available: {
    disc: "bg-white ring-1 ring-black/[0.14] text-[#6E6E78]/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
    text: "text-[#6E6E78]/80",
    glyph: "▤",
  },
  complete: {
    disc: "bg-gradient-to-br from-indigo-500/20 to-fuchsia-600/20 ring-1 ring-black/[0.08] text-[#1A1A24]/70",
    text: "text-[#1A1A24]/70",
    glyph: "✓",
  },
};

/**
 * A flashcard-deck path node — LEARN_PLAN.md "Flashcard decks", corrected
 * placement (2026-08-12): decks are their own satellite stops on the spine,
 * NOT steps inside the unit Player. The entry deck brackets its unit row on
 * top, the exit deck brackets it on the bottom (see the call site in the
 * main render loop). Deliberately lighter than `UnitRow` — a 20px disc vs.
 * 28px, 11px type vs. 14/15px, muted tone even once tappable — these are
 * satellites of the unit, not another peer stop like a proof/checkpoint/
 * workshop node. The "▤" glyph is unique in the node vocabulary (◆/◇/✓ =
 * unit, ∴ = proof, ⚡ = checkpoint, § = workshop) so a deck reads as "a stack
 * of cards" at a glance, swapping to the shared "✓" done language once every
 * card in the deck has an attempt. `available` (and therefore tappable) is
 * resolved by the caller: entry whenever the unit itself is
 * available/in_progress/mastered, exit only once the unit is mastered — both
 * still RENDER before that (dim, inert), previewing what's ahead rather than
 * hiding like a proof reward does.
 */
function DeckNode({
  label,
  cardCount,
  solvedCount,
  available,
  onOpen,
}: {
  label: string;
  cardCount: number;
  solvedCount: number;
  available: boolean;
  onOpen: () => void;
}) {
  const complete = cardCount > 0 && solvedCount >= cardCount;
  const state = complete ? "complete" : available ? "available" : "locked";
  const tone = DECK_NODE_TONE[state];
  const clickable = available;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? onOpen : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors ${
        clickable ? "active:bg-black/[0.03] md:hover:bg-black/[0.02]" : "cursor-default"
      }`}
    >
      <span
        className={`relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] ${tone.disc}`}
      >
        {tone.glyph}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[11px] ${tone.text}`}>{label}</span>
      {cardCount > 0 && (
        <span className="shrink-0 text-[9px] tabular-nums text-[#6E6E78]/40">
          {solvedCount}/{cardCount}
        </span>
      )}
    </button>
  );
}

/**
 * A Socratic-dialogue side-node — LEARN_PLAN.md "Socratic dialogue nodes".
 * Sized/shaped exactly like `DeckNode` (20px disc, 11px label, same row
 * geometry) — deliberately "visually a sibling of deck nodes" per the spec,
 * not a peer stop on the spine like `ProofNode`'s indented ∴ branch or
 * `WorkshopNode`'s full-width row. Only ever rendered once the parent unit
 * is mastered (the call site's own gate, mirroring `ProofNode`'s "locked is
 * absence, not a visible state"), so unlike `DeckNode` this has no "locked"
 * tone to draw — it is either available (gradient-tinted "?" disc) or
 * completed (the shared "✓ done" language every side-node swaps to).
 */
function SocraticNode({ entry, title, onOpen }: { entry: ProofUnitEntry; title: string; onOpen: () => void }) {
  const completed = entry.progress === "completed";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors active:bg-black/[0.03] md:hover:bg-black/[0.02]"
    >
      <span
        className={`relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] ${
          completed
            ? "bg-gradient-to-br from-indigo-500/25 to-fuchsia-600/25 ring-1 ring-black/[0.08] text-[#1A1A24]/75"
            : "bg-gradient-to-br from-indigo-500/15 to-fuchsia-600/15 ring-1 ring-indigo-400/35 text-indigo-700/85"
        }`}
      >
        {completed ? "✓" : "?"}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[11px] ${completed ? "text-[#1A1A24]/70" : "text-[#6E6E78]/85"}`}>
        {title}
      </span>
    </button>
  );
}

/**
 * A proof side-node — LEARN_PLAN.md "Proof side-paths". Branches off a
 * mastered unit's row via a short dashed connector (never a full rail
 * segment: this is a reward, not another stop on the spine). "∴" (QED-ish,
 * matches the course's own proof vocabulary) reads muted until the proof is
 * completed, at which point it swaps to the same gradient-fill + check the
 * main spine uses for a mastered unit — one shared "done" language, smaller.
 * Content-less proofs (pilot content authored concurrently, per
 * LEARN_PLAN.md) still render and are still tappable: the Player itself
 * carries the quiet "ikke klar endnu" empty state, so there is nothing this
 * node needs to know about content presence.
 */
function ProofNode({
  entry,
  title,
  onOpen,
}: {
  entry: ProofUnitEntry;
  title: string;
  onOpen: () => void;
}) {
  const completed = entry.progress === "completed";
  return (
    <div className="relative ml-10 flex items-center py-0.5 pl-4 before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:-translate-y-1/2 before:border-t before:border-dashed before:border-black/[0.16] before:content-['']">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-[36px] min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors active:bg-black/[0.03] md:hover:bg-black/[0.025]"
      >
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
            completed
              ? "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white ring-1 ring-black/10"
              : "bg-transparent text-[#6E6E78]/40 ring-1 ring-dashed ring-black/[0.18] group-active:text-[#6E6E78]/75"
          }`}
        >
          {completed ? "✓" : "∴"}
        </span>
        <span
          className={`truncate text-[12px] ${completed ? "text-[#1A1A24]/75" : "text-[#6E6E78]/55"} md:text-[12.5px]`}
        >
          {title}
        </span>
      </button>
    </div>
  );
}

/**
 * A chapter checkpoint — LEARN_PLAN.md's "Lynudfordring — timed challenge"
 * pilot (2026-08-10), piloted at LA 2's end but generic by chapter. Sits on
 * the rail after a chapter's last unit row, distinct from both the unit
 * nodes above it (status ramp, glyph-per-state) and the ∴ proof side-nodes
 * (indented sub-branch off one mastered unit): this is a full-width row like
 * `UnitRow`, but its own gradient-filled ⚡ disc marks it as "a practice
 * mode", not "another stop on the spine" — and unlike every unit node, it is
 * never locked/available/mastered itself. It opens
 * `ChallengeSession({ chapter })`, which pulls its pool from the whole
 * chapter regardless of per-unit lock state (api.fetchChallengePool's doc
 * comment) — the checkpoint's own visibility (only once ≥1 unit in the
 * chapter has mastered, see the call site) is the only gate, and even that
 * is a practice invitation, not a progression requirement: the rest of the
 * spine never checks whether a checkpoint was played.
 */
function ChapterChallengeNode({ chapter, onOpen }: { chapter: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors active:bg-black/[0.03] md:gap-4 md:py-2.5 md:hover:bg-black/[0.025]"
    >
      <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[12px] text-white shadow-[0_0_14px_-4px_rgba(217,70,239,0.55)]">
        ⚡
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block truncate text-[13px] font-medium text-[#1A1A24]/80 md:text-[14px]">
          Lynudfordring · {chapter}
        </span>
        <span className="mt-0.5 block text-[10px] text-[#6E6E78]/70 md:text-[11px]">15 min · 3 runder · checkpoint</span>
      </span>
      <span className="pt-1 text-[#6E6E78]/45 group-active:text-[#1A1A24]/60">›</span>
    </button>
  );
}

/**
 * An exam-workshop side-node — LEARN_PLAN.md "Eksamensværksted". Sits at
 * chapter-end as a full-width sibling of `ChapterChallengeNode` (same row
 * shape, same "≥1 unit in the chapter mastered" gate at the call site — never
 * a per-unit rule like `ProofNode`'s ∴), but never confused with it: "§"
 * marks it as a solve-and-present workshop rather than a timed drill round.
 * Per DESIGN.md's "gradient means progress" rule, the disc reuses the same
 * indigo→fuchsia gradient token the checkpoint's ⚡ disc uses — this node only
 * exists once it's unlocked, so showing it at all already *is* the earned
 * state; completion swaps the glyph to the shared "✓ done" language (same
 * swap `ProofNode` makes) without changing the disc's gradient.
 */
function WorkshopNode({ entry, title, onOpen }: { entry: ProofUnitEntry; title: string; onOpen: () => void }) {
  const completed = entry.progress === "completed";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors active:bg-black/[0.03] md:gap-4 md:py-2.5 md:hover:bg-black/[0.025]"
    >
      <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[12px] text-white shadow-[0_0_14px_-4px_rgba(217,70,239,0.55)]">
        {completed ? "✓" : "§"}
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block truncate text-[13px] font-medium text-[#1A1A24]/80 md:text-[14px]">{title}</span>
        <span className="mt-0.5 block text-[10px] text-[#6E6E78]/70 md:text-[11px]">Eksamensværksted</span>
      </span>
      <span className="pt-1 text-[#6E6E78]/45 group-active:text-[#1A1A24]/60">›</span>
    </button>
  );
}
