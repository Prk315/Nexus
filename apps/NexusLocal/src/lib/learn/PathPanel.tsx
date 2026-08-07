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
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchPath, fetchUnitContent, setUnitProgress } from "./api";
import type { PathUnit, UnitContent } from "./types";
import { Player } from "./Player";

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
  const [path, setPath] = useState<PathUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentByUnit, setContentByUnit] = useState<Map<number, UnitContent>>(new Map());
  const [expandedLocked, setExpandedLocked] = useState<number | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [railHeightPx, setRailHeightPx] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Load the spine, then fill in per-unit content (title/counts) for whatever
  // has any — see contract-gap note #1 above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const p = await fetchPath();
        if (cancelled) return;
        setPath(p);

        const withContent = p.filter((pu) => pu.hasContent);
        const pairs = await Promise.all(
          withContent.map(async (pu) => {
            const row = await fetchUnitContent(pu.unit.unit_id).catch(() => null);
            return [pu.unit.unit_id, row?.content ?? null] as const;
          })
        );
        if (cancelled) return;
        const map = new Map<number, UnitContent>();
        for (const [id, content] of pairs) if (content) map.set(id, content);
        setContentByUnit(map);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

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

  return (
    <section className="flex flex-col gap-2">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="pathGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
      </svg>

      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-[#6E6E78]">Learn · Lineær Algebra</h2>
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

      {error && (
        <div className="rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 ring-1 ring-red-500/20">{error}</div>
      )}

      {!path ? (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Loading path…
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
            <HeaderRing mastered={masteredCount} total={total} />
            <div className="min-w-0">
              <div className="text-xs text-[#6E6E78]">
                {masteredCount} / {total} mastered
              </div>
              {currentChapterLabel && (
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-[#6E6E78]/70">
                  {currentChapterLabel}
                </div>
              )}
            </div>
          </div>

          <div ref={listRef} className="relative flex flex-col">
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
                    return (
                      <UnitRow
                        key={pu.unit.unit_id}
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
                    );
                  })}
                </div>
              );
            })}
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
    <div className="relative flex items-center gap-2 pl-[14px] pt-4 pb-1">
      <span className="-ml-[14px] w-7 shrink-0 bg-[#F6F5F1] text-center text-[10px] font-semibold tracking-wider text-[#6E6E78]/70">
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
        className={`group flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left transition-colors ${
          clickable ? "active:bg-black/[0.03]" : "cursor-default"
        }`}
      >
        <UnitNode status={status} draft={draft} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className={`block truncate text-[14px] font-medium ${STATUS_ROW_TEXT[status]}`}>{title}</span>
          <span className="mt-0.5 block text-[10px] text-[#6E6E78]/70">{meta}</span>
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
