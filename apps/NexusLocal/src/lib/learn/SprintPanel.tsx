/**
 * Sprint entry card — LEARN_PLAN.md's pinned "Sprint — bucketed fast-feedback
 * exam training" section (DBMS pilot, 2026-08-18) and the sprint UI brief
 * §D.2. Same anatomy as `ChallengePanel.tsx`/`InfinitePanel.tsx`: a
 * `CARD`-stock row with a 48px gradient medallion, a two-line readout, and a
 * `Start →` button that opens `SprintSession`.
 *
 * The panel's whole value is the "Next: …" line — it tells you what you're
 * bad at before you tap, using the SAME ordering rule (never-practiced
 * first, then lowest accuracy) `SprintSession` uses to pick its own first
 * bucket, computed from `api.fetchSprintBuckets`'s RPC — no separate
 * heuristic invented here.
 *
 * Renders only when this course has ≥1 live/draft sprint drill (zero rows →
 * `null`, so a course with no Sprint content yet is byte-identical to
 * today). Refetches on session close, same "reload on close" relationship
 * `ChallengePanel`/`InfinitePanel` have to their own sessions.
 */

import { useEffect, useState } from "react";
import { fetchSprintBuckets, fetchSprintHasDraft } from "./api";
import type { SprintBucketStat } from "./types";
import { useCourse } from "./CourseContext";
import { SprintSession } from "./SprintSession";

/** Never-practiced first (stable among fresh buckets), then lowest accuracy,
 * then least-practised — the exact ordering `SprintSession` computes once at
 * session start (UI brief §D.4). Duplicated here (not imported) because the
 * panel needs only the HEAD of the ordering, not the session's full queue
 * machinery — see `SprintSession.tsx`'s own copy for the canonical version. */
function orderBuckets(rows: SprintBucketStat[]): SprintBucketStat[] {
  return rows
    .filter((r) => r.drills > 0)
    .slice()
    .sort((a, b) => {
      const an = a.attempts === 0;
      const bn = b.attempts === 0;
      if (an !== bn) return an ? -1 : 1;
      if (an && bn) return a.bucket.localeCompare(b.bucket);
      const aa = a.accuracy ?? 1;
      const ba = b.accuracy ?? 1;
      if (aa !== ba) return aa - ba;
      return a.attempts - b.attempts;
    });
}

export function SprintPanel() {
  const { course } = useCourse();
  // undefined = loading, null = the fetch failed outright.
  const [buckets, setBuckets] = useState<SprintBucketStat[] | null | undefined>(undefined);
  const [hasDraft, setHasDraft] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    if (sessionOpen) return;
    let cancelled = false;
    setBuckets(undefined);
    Promise.all([fetchSprintBuckets(course.courseId), fetchSprintHasDraft(course.courseId).catch(() => false)])
      .then(([rows, draft]) => {
        if (!cancelled) {
          setBuckets(rows);
          setHasDraft(draft);
        }
      })
      .catch((e) => {
        console.error("[learn] fetchSprintBuckets failed", e);
        if (!cancelled) setBuckets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionOpen, course.courseId]);

  // Renders only when the course has ≥1 sprint drill — a course with none
  // yet (LA today) stays byte-identical to before this panel existed.
  const liveBuckets = buckets ? orderBuckets(buckets) : [];
  const totalDrills = buckets ? buckets.reduce((n, b) => n + b.drills, 0) : 0;

  if (buckets !== undefined && (buckets === null || totalDrills === 0)) return null;

  const next = liveBuckets[0];
  const nextLabel =
    buckets === undefined
      ? "Loading…"
      : next
        ? next.attempts === 0
          ? `Next: ${next.bucket}`
          : `Next: ${next.bucket} · ${Math.round((next.accuracy ?? 0) * 100)} %`
        : "";

  return (
    <section className="flex flex-col gap-2 md:gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">🏃 Sprint</h2>
        {hasDraft && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/30">
            KLADDE
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:gap-5 md:rounded-2xl md:p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-lg text-white shadow-[0_0_18px_-6px_rgba(217,70,239,0.5)] md:h-14 md:w-14 md:text-xl">
          🏃
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[#1A1A24]/80">
            {liveBuckets.length} buckets · {totalDrills} drills
          </div>
          <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-[#6E6E78]/80">{nextLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => setSessionOpen(true)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[13px] font-semibold text-white transition-transform active:scale-[0.985] md:px-5 md:text-[14px]"
        >
          Start →
        </button>
      </div>

      {sessionOpen && <SprintSession onClose={() => setSessionOpen(false)} />}
    </section>
  );
}
