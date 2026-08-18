/**
 * "Statistik" board — the Learn feature's progress dashboard. Consumes the
 * pure aggregation module `stats.ts` and the fetches `api.ts` carries for it;
 * this file owns fetch orchestration, React state, and the mapping from each
 * of the design contract's 8 chart/tile forms onto the primitives in
 * `stats/charts.tsx`. No new dependency — every mark is hand-built SVG/HTML.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `lr_attempt_log`/`lr_unit_progress` rows carry (or can be joined to) a
 * course, so those charts re-derive against `useCourse()`'s active course
 * and change when the course switches:
 *   - Volume (Form 2), accuracy-over-time (Form 3): `courseOfItemRef` filters
 *     `item_ref` before handing rows to `stats.dailyVolume`/`dailyAccuracy`.
 *   - Mastery growth (Form 4): `lr_unit_progress` filtered to this course's
 *     `unit_id`s via `fetchUnitCourseMap`'s join, same idiom
 *     `stats.masteryByCourse` itself uses.
 *   - Per-lens small multiples (Form 5): `course.lensOrder` IS the facet set.
 *   - Sprint buckets (Form 6): `fetchSprintBuckets(course.courseId)` is
 *     course-scoped at the RPC itself (`SprintPanel.tsx`'s own pattern).
 *   - Activity heatmap (Form 8): same course-filtered attempts as volume.
 *
 * `lr_memory_state` carries no `course_id` and this slice has no
 * `lr_unit_concept` fetch to derive one, so weakest concepts (Form 7) and the
 * headline row (Form 1) are deliberately GLOBAL — every course's evidence
 * combined — and say so in their own subtitles rather than silently implying
 * a course scope they don't have.
 */

import { useEffect, useMemo, useState } from "react";
import {
  fetchAttempts,
  fetchAllMemoryStates,
  fetchConceptTitles,
  fetchAllUnitProgress,
  fetchUnitCourseMap,
  fetchChallengeRuns,
  fetchSprintBuckets,
  fetchLearnState,
} from "./api";
import {
  dailyVolume,
  dailyAccuracy,
  masteryGrowth,
  perLens,
  sprintWeakestBuckets,
  weakestConcepts,
  activityCalendar,
  headlineTiles,
  bestChallengeRun,
  courseOfItemRef,
  type AttemptRow,
} from "./stats";
import type { LrMemoryState, LrUnitProgress, LrLearnState, SprintBucketStat, LrChallengeRun } from "./types";
import { COURSES } from "./courses";
import { useCourse } from "./CourseContext";
import { StatTile, ChartCard, DataTable, EmptyState, BarChart, LineChart, HBarChart, Heatmap } from "./stats/charts";

// Local-day (Europe/Copenhagen) formatters for axis ticks / tooltips / table
// rows — dates coming out of `stats.ts` are already `YYYY-MM-DD` local keys,
// so these only need to *display* them, never re-derive the timezone.
const TICK_FMT = new Intl.DateTimeFormat("da-DK", { day: "2-digit", month: "2-digit" });
const FULL_FMT = new Intl.DateTimeFormat("da-DK", { day: "2-digit", month: "long", year: "numeric" });

function tickLabel(dateKey: string): string {
  return TICK_FMT.format(new Date(`${dateKey}T12:00:00`));
}
function fullLabel(dateKey: string): string {
  return FULL_FMT.format(new Date(`${dateKey}T12:00:00`));
}

interface LoadedData {
  attempts: AttemptRow[];
  memoryRows: LrMemoryState[];
  titles: Record<string, string>;
  progressRows: LrUnitProgress[];
  unitCourseRows: Array<{ unit_id: number; course_id: number | null }>;
  learnState: LrLearnState | null;
  challengeRuns: LrChallengeRun[];
}

export function StatsPanel() {
  const { course } = useCourse();
  // undefined = loading, null = the fetch failed outright.
  const [data, setData] = useState<LoadedData | null | undefined>(undefined);
  const [sprintBuckets, setSprintBuckets] = useState<SprintBucketStat[] | null>(null);

  // Global rows — fetched once, independent of the active course (see file
  // header). Concept titles need the memory rows' concept ids first, so this
  // resolves in two steps rather than one flat `Promise.all`.
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    (async () => {
      try {
        const [attempts, memoryRows, progressRows, unitCourseRows, learnState, challengeRuns] = await Promise.all([
          fetchAttempts(),
          fetchAllMemoryStates(),
          fetchAllUnitProgress(),
          fetchUnitCourseMap(),
          fetchLearnState().catch(() => null),
          fetchChallengeRuns().catch(() => [] as LrChallengeRun[]),
        ]);
        const titles = await fetchConceptTitles(memoryRows.map((m) => m.concept_id)).catch(
          () => ({}) as Record<string, string>
        );
        if (cancelled) return;
        setData({ attempts, memoryRows, titles, progressRows, unitCourseRows, learnState, challengeRuns });
      } catch (e) {
        console.error("[learn] StatsPanel global fetch failed", e);
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sprint buckets are course-scoped at the RPC itself — refetch on switch,
  // same relationship `SprintPanel.tsx` has to `course.courseId`.
  useEffect(() => {
    let cancelled = false;
    fetchSprintBuckets(course.courseId)
      .then((rows) => {
        if (!cancelled) setSprintBuckets(rows);
      })
      .catch((e) => {
        console.error("[learn] StatsPanel fetchSprintBuckets failed", e);
        if (!cancelled) setSprintBuckets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [course.courseId]);

  const courseAttempts = useMemo(
    () => (data ? data.attempts.filter((a) => courseOfItemRef(a.item_ref) === course.key) : []),
    [data, course.key]
  );

  const courseProgressRows = useMemo(() => {
    if (!data) return [];
    const unitIds = new Set(
      data.unitCourseRows.filter((u) => u.course_id === course.courseId).map((u) => u.unit_id)
    );
    return data.progressRows.filter((p) => unitIds.has(p.unit_id));
  }, [data, course.courseId]);

  if (data === undefined) {
    return (
      <section className="flex flex-col gap-2 md:gap-3">
        <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">📊 Statistik</h2>
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Indlæser…
        </div>
      </section>
    );
  }

  if (data === null) {
    return (
      <section className="flex flex-col gap-2 md:gap-3">
        <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">📊 Statistik</h2>
        <div className="rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-4 text-center text-[12px] text-[#6E6E78]/70">
          Statistikken kunne ikke indlæses.
        </div>
      </section>
    );
  }

  // ── Form-by-form derivations — `stats.ts` already did the math; this only
  // scopes inputs and shapes them for the chart primitives. ────────────────
  const tiles = headlineTiles({
    attempts: data.attempts,
    memoryRows: data.memoryRows,
    progressRows: data.progressRows,
    unitCourseRows: data.unitCourseRows,
    learnState: data.learnState,
  });
  const best = bestChallengeRun(data.challengeRuns);

  const volume = dailyVolume(courseAttempts, 42);
  const accuracy = dailyAccuracy(courseAttempts, 42);
  const growth = masteryGrowth(courseProgressRows);
  const lensFacets = perLens(courseAttempts, course.lensOrder);
  const weakest = weakestConcepts(data.memoryRows, data.titles, 3, 10);
  const activity = activityCalendar(courseAttempts, 6);
  const weakestBuckets = sprintBuckets ? sprintWeakestBuckets(sprintBuckets) : [];
  const totalSprintDrills = sprintBuckets ? sprintBuckets.reduce((n, b) => n + b.drills, 0) : 0;

  return (
    <section className="flex flex-col gap-3 md:gap-4">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">📊 Statistik</h2>

      {/* Form 1 — headline stat tiles, GLOBAL (every course combined). */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatTile label="forsøg i alt" value={tiles.totalAttempts.toLocaleString("da-DK")} />
        <StatTile
          label="nøjagtighed, 7 dage"
          value={tiles.accuracy7d.accuracy === null ? "—" : `${Math.round(tiles.accuracy7d.accuracy * 100)}%`}
          sub={tiles.accuracy7d.total > 0 ? `${tiles.accuracy7d.correct}/${tiles.accuracy7d.total}` : undefined}
        />
        <StatTile label="begreber trænet" value={tiles.conceptsRetained.toLocaleString("da-DK")} accent />
        <StatTile
          label="dages stime"
          value={tiles.streakDays === null ? "—" : tiles.streakDays}
          sub={tiles.streakDays === null ? "ukendt" : undefined}
          accent={tiles.streakDays !== null && tiles.streakDays > 0}
        />
      </div>

      {tiles.masteryByCourse.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {tiles.masteryByCourse.map((m) => {
            const def = Object.values(COURSES).find((c) => c.courseId === m.courseId);
            return (
              <StatTile
                key={m.courseId}
                label={`${def?.title ?? `kursus ${m.courseId}`} — mestrede enheder`}
                value={`${m.mastered}/${m.total}`}
                accent={m.mastered > 0}
              />
            );
          })}
        </div>
      )}

      {best && (
        <div className="rounded-xl border border-black/[0.06] bg-white p-3 text-[11px] text-[#1A1A24]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl md:p-4">
          Bedste Lynudfordring: <span className="font-semibold text-[#1A1A24]/90">{best.score} point</span>
          {" · "}
          {best.correct}/{best.total} korrekte
          {best.bestStreak != null && <> · {best.bestStreak} i træk</>}
        </div>
      )}

      {/* Form 2 (bar, single series) + Form 3 (line, single series, separate
          chart sharing the same 6-week x-range) — SCOPED to the active course. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <ChartCard
          title="Aktivitet pr. dag"
          sub={`${course.title} · seneste 6 uger`}
          table={
            <DataTable
              columns={["Dato", "Forsøg"]}
              rows={volume.filter((d) => d.count > 0).map((d) => [fullLabel(d.date), d.count])}
            />
          }
        >
          <BarChart
            data={volume.map((d) => ({
              key: d.date,
              value: d.count,
              tickLabel: tickLabel(d.date),
              tooltipLabel: fullLabel(d.date),
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Nøjagtighed pr. dag"
          sub={`${course.title} · seneste 6 uger`}
          table={
            <DataTable
              columns={["Dato", "Korrekte", "Forsøg", "Nøjagtighed"]}
              rows={accuracy
                .filter((d) => d.total > 0)
                .map((d) => [fullLabel(d.date), d.correct, d.total, `${Math.round((d.accuracy ?? 0) * 100)}%`])}
            />
          }
        >
          <LineChart
            data={accuracy.map((d) => ({
              key: d.date,
              value: d.accuracy === null ? null : d.accuracy * 100,
              tickLabel: tickLabel(d.date),
              tooltipLabel: fullLabel(d.date),
            }))}
            formatValue={(v) => `${Math.round(v)}`}
            unit="%"
          />
        </ChartCard>
      </div>

      {/* Form 4 — mastery growth, step line, SCOPED to the active course. */}
      <ChartCard
        title="Mestring over tid"
        sub={`${course.title} · kumuleret`}
        table={
          <DataTable columns={["Dato", "Mestrede enheder"]} rows={growth.map((g) => [fullLabel(g.date), g.cumulative])} />
        }
      >
        {growth.length === 0 ? (
          <EmptyState />
        ) : (
          <LineChart
            stepped
            data={growth.map((g, i) => ({
              key: `${g.date}-${i}`,
              value: g.cumulative,
              tickLabel: i === 0 || i === growth.length - 1 ? tickLabel(g.date) : undefined,
              tooltipLabel: fullLabel(g.date),
            }))}
            formatValue={(v) => `${v}`}
          />
        )}
      </ChartCard>

      {/* Form 5 — per-lens small multiples. Identity comes from each facet's
          title + lens chip, never from bar color alone (the lens hexes fail
          CVD separation as chart series — see `stats/charts.tsx`'s header). */}
      {course.lensOrder.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-medium text-[#6E6E78]">Pr. perspektiv · {course.title}</h3>
          {/* Capped at 2 columns, not 3: the Learn page's content column is a
              fixed ~530px regardless of viewport (it does not track window
              width), so a 3-up grid squeezed lens titles like "Rækkebilledet"
              /"Matrixformen" to ~80px next to their badge chip and clipped
              them mid-word even though "Søjlebilledet" (same length) just
              barely fit — an inconsistent, viewport-breakpoint-driven
              truncation bug. 2 columns leaves headroom for every course's
              lens names (LA's 3, DBMS's 4) without touching ChartCard's
              shared truncate behavior. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {lensFacets.map((f) => {
              const token = course.lenses[f.lens];
              return (
                <ChartCard
                  key={f.lens}
                  title={token?.long ?? f.lens}
                  sub={f.attempts === 0 ? "Ingen forsøg endnu" : `${f.correct}/${f.attempts} korrekte`}
                  badge={
                    token && (
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${token.chip}`}
                      >
                        <span className={`h-1 w-1 rounded-full ${token.dot}`} />
                        {token.label}
                      </span>
                    )
                  }
                >
                  {f.attempts === 0 ? (
                    <EmptyState height={56} />
                  ) : (
                    <MiniAccuracyBar correct={f.correct} attempts={f.attempts} />
                  )}
                </ChartCard>
              );
            })}
          </div>
        </div>
      )}

      {/* Form 6 — sprint buckets, weakest first, only when this course has
          sprint drills (mirrors `SprintPanel.tsx`'s own gate). */}
      {totalSprintDrills > 0 && (
        <ChartCard
          title="Sprint-buckets"
          sub={`${course.title} · svageste først`}
          table={
            <DataTable
              columns={["Bucket", "Korrekte", "Forsøg", "Nøjagtighed"]}
              rows={weakestBuckets.map((b) => [b.bucket, b.correct, b.attempts, `${Math.round((b.accuracy ?? 0) * 100)}%`])}
            />
          }
        >
          <HBarChart
            data={weakestBuckets.map((b) => ({
              key: b.bucket,
              label: b.bucket,
              value: b.accuracy ?? 0,
              display: `${b.correct}/${b.attempts} · ${Math.round((b.accuracy ?? 0) * 100)}%`,
            }))}
          />
        </ChartCard>
      )}

      {/* Form 8 — activity calendar heatmap, SCOPED to the active course. */}
      <ChartCard
        title="Aktivitet"
        sub={`${course.title} · seneste 6 uger`}
        table={
          <DataTable
            columns={["Dato", "Forsøg"]}
            rows={activity.filter((d) => d.count > 0).map((d) => [fullLabel(d.date), d.count])}
          />
        }
      >
        <Heatmap data={activity.map((d) => ({ count: d.count, dow: d.dow, tooltipLabel: fullLabel(d.date) }))} />
      </ChartCard>

      {/* Form 7 — weakest concepts, GLOBAL (see file header: no course id on
          `lr_memory_state`, and no unit→concept fetch to derive one). */}
      <ChartCard
        title="Svageste begreber"
        sub="På tværs af alle kurser · min. 3 observationer"
        table={
          <DataTable
            columns={["Begreb", "Styrke", "Observationer"]}
            rows={weakest.map((w) => [w.title, `${Math.round(w.mean * 100)}%`, w.evidence.toFixed(1)])}
          />
        }
      >
        <HBarChart
          data={weakest.map((w) => ({
            key: w.conceptId,
            label: w.title,
            value: w.mean,
            display: `${Math.round(w.mean * 100)}%`,
            sublabel: `${w.evidence.toFixed(1)} observationer`,
          }))}
        />
      </ChartCard>
    </section>
  );
}

/** Per-lens facet body — one baseline-anchored bar (correct share) plus the
 * percentage, direct-labelled. A full time-series chart per facet would be
 * noise at this size; this keeps the same 4px-rounded, indigo-mark language
 * as every other bar on the board. */
function MiniAccuracyBar({ correct, attempts }: { correct: number; attempts: number }) {
  const pct = attempts > 0 ? correct / attempts : 0;
  return (
    <div>
      <div className="h-4 w-full overflow-hidden rounded bg-black/[0.05]">
        <div className="h-4 rounded-r-[4px] bg-[#4f46e5]" style={{ width: `${Math.max(3, pct * 100)}%` }} />
      </div>
      <div className="mt-1.5 text-right font-mono text-[13px] font-semibold tabular-nums text-[#1A1A24]/85">
        {Math.round(pct * 100)}%
      </div>
    </div>
  );
}
