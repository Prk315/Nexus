/**
 * Pure aggregation module for the "Statistik" board (Learn feature progress
 * dashboard). React-free by design — mirrors `timetracker/coverage.ts`'s
 * split: this file only transforms rows already fetched by `api.ts` into the
 * shapes the design contract's 8 chart/tile forms need. No Supabase import,
 * no `invoke`, no React. Every exported function is a plain, deterministic
 * transform over its inputs so it can be unit-tested without a DB or a DOM.
 *
 * ── Course scoping ───────────────────────────────────────────────────────
 * `lr_attempt_log.item_ref` carries no `course_id` column — courses are
 * distinguished purely by the `item_ref` STRING's prefix convention, and that
 * convention differs by content type. Inventory taken against the live table
 * (`user_id='default'`, 795 rows, 2026-08-18) via distinct-prefix queries:
 *
 *   `la_<n>_u<n>-p<n>-d<n>`   unit-content drill id     (e.g. `la_2_u1-p1-d1`)
 *   `la_<n>_u<n>-fc-<id>`     flashcard entry/exit card (e.g. `la_2_u3-fc-e2`)
 *   `la-book-<ch>-<n>`        Infinite-exercises item, book source
 *   `la-prove{I,II}-<yr>-<n>` Infinite-exercises item, "prøve" (midterm) source
 *   `la-eksamen<yr>-<n>`      Infinite-exercises item, exam source
 *   `spr-dbms-<bucket>-<n>`   Sprint drill code (DBMS pilot)
 *   `bh-<ref>-<slug>`         Infinite-exercises item, "BH" (Brualdi/Held
 *                             combinatorics textbook) source — NOT a Learn
 *                             course at all (no `lr_course` row backs it;
 *                             pre-dates the `la`/`dbms` course split, still
 *                             lives in `lr_item` with `source_ref: "BH …"`).
 *                             5 attempts total, all-time.
 *
 * No `dbms_`-prefixed unit-drill ids exist in the live table yet — DBMS's
 * Section 1 unit content is still being authored (`courses.ts`'s
 * `complete: false`), and its only graded content so far is the Sprint
 * pilot. `courseOfItemRef` below still recognizes a `dbms_`/`dbms-` prefix
 * for forward compatibility once unit drills land.
 *
 * Everything that doesn't match `la`/`dbms` (today: only `bh-*`) resolves to
 * the explicit `"other"` bucket — never silently dropped, per the task's
 * "put anything unmatched in an explicit 'other' rather than silently
 * dropping it" instruction. Callers scoping a chart to one course simply
 * filter attempts to `courseOfItemRef(a.item_ref) === course.key` first;
 * every function below takes already-scoped rows and has no course
 * knowledge of its own (course-agnostic in, course-scoped by the caller).
 *
 * ── "Correct" convention ─────────────────────────────────────────────────
 * `grade >= 2` is "correct" here — NOT `grade > 0`, which is what
 * `memory.ts`'s `applyGrade` uses for the alpha/beta Beta-model update. The
 * two conventions genuinely differ and both are "correct" for their own
 * purpose: `ChallengeSession.tsx` and `AggregateTestSession.tsx` both encode
 * a WRONG multiple-choice answer as `grade: 1` ("never 0 — a timed miss is
 * weak evidence" / "never 0" respectively), specifically so it still nudges
 * the Beta model's `alpha` upward a little. Reusing `grade > 0` here would
 * therefore report those wrong answers as 100% accurate, which is exactly
 * backwards for a stats board. `grade 2` (normal) and `grade 3` (easy) are
 * the only grades that mean "the learner actually got it right" everywhere
 * this app logs an attempt.
 *
 * ── Local-day bucketing ──────────────────────────────────────────────────
 * The user is in Europe/Copenhagen. Every "which day did this happen on"
 * decision goes through `localDayKey`, which resolves via `Intl` against the
 * IANA tz database — not a fixed UTC+1/+2 offset — so it stays correct
 * across the CEST/CET boundary without this file needing to know today's
 * offset. An evening session (e.g. 22:30 local in August = 20:30 UTC) must
 * bucket to today's local date, not tomorrow's UTC date.
 */

import type { Grade, Lens, LrLearnState, LrMemoryState, LrUnitProgress, SprintBucketStat } from "./types";
import type { CourseKey } from "./courses";

// ── Local-day bucketing ─────────────────────────────────────────────────

const TZ = "Europe/Copenhagen";

// `en-CA` formats as `YYYY-MM-DD` directly — no manual string surgery, and
// `Intl`'s `timeZone` option resolves through the IANA database so DST
// transitions are handled by the platform, not by this file.
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Europe/Copenhagen calendar date (`YYYY-MM-DD`) a UTC instant falls on. */
export function localDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return DAY_KEY_FMT.format(d);
}

/** `n` consecutive local day keys ending at (and including) today, oldest
 * first — the zero-fill spine every day-bucketed chart below is built on. */
function dayRange(days: number, now: Date = new Date()): string[] {
  const todayKey = localDayKey(now);
  // Anchor at local noon on today's calendar date so subtracting whole days
  // in UTC millis never crosses a DST boundary into the wrong calendar date
  // (midnight local + a -1h DST fall-back could otherwise round to the
  // previous day). Noon has >=12h of slack either side of any DST shift.
  const anchor = new Date(`${todayKey}T12:00:00`);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(localDayKey(d));
  }
  return out;
}

/** Monday=0 … Sunday=6 (Danish week start) for a `YYYY-MM-DD` key. Computed
 * off the calendar date alone (UTC-anchored `Date.UTC`), never off a moment
 * in time, so it needs no timezone reasoning of its own. */
function mondayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const sunIndexed = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (sunIndexed + 6) % 7; // 0=Mon..6=Sun
}

// ── Course scoping ───────────────────────────────────────────────────────

/**
 * Which course (or `"other"`) an `lr_attempt_log.item_ref` belongs to, from
 * its own prefix — see the file header's prefix inventory. `la`/`dbms` match
 * both the unit-drill `_` separator (`la_2_u1-...`) and the Infinite-
 * exercises/Sprint `-` separator (`la-book-...`, `spr-dbms-...`) forms.
 */
export function courseOfItemRef(itemRef: string): CourseKey | "other" {
  if (/^la[-_]/.test(itemRef)) return "la";
  if (/^dbms[-_]/.test(itemRef)) return "dbms";
  if (/^spr-dbms-/.test(itemRef)) return "dbms";
  if (/^spr-la-/.test(itemRef)) return "la";
  return "other";
}

// ── Shared row shapes ────────────────────────────────────────────────────

/** One `lr_attempt_log` row, trimmed to the columns every function below
 * needs — matches what `api.fetchAttempts` selects. */
export interface AttemptRow {
  item_ref: string;
  lens: Lens | null;
  grade: Grade;
  at: string;
}

/** `grade >= 2` — see the file header's "Correct convention" section. */
export const CORRECT_GRADE_THRESHOLD = 2;

export function isCorrectAttempt(grade: Grade): boolean {
  return grade >= CORRECT_GRADE_THRESHOLD;
}

// ── Form 2: Volume over time (bar, single series) ───────────────────────

export interface DayVolume {
  date: string; // YYYY-MM-DD, local
  count: number;
}

/** Attempts per local day over the trailing `days` window (default 42 = 6
 * weeks), zero-filled — a day with no attempts is `count: 0`, not absent, so
 * a bar chart never silently skips a bar. */
export function dailyVolume(attempts: AttemptRow[], days: number = 42, now: Date = new Date()): DayVolume[] {
  const counts = new Map<string, number>();
  for (const a of attempts) {
    const k = localDayKey(a.at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return dayRange(days, now).map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

// ── Form 3: Accuracy over time (line, single series, separate chart) ────

export interface DayAccuracy {
  date: string;
  correct: number;
  total: number;
  /** `null` iff `total === 0` — an explicit "no attempts that day" reading,
   * never `0`, which would misread as "0% accuracy" (mirrors
   * `SprintBucketStat.accuracy`'s own documented null convention). Chart
   * callers should render a gap/no-marker on null days, not a dip to zero. */
  accuracy: number | null;
}

/** Correct-rate per local day over the trailing `days` window (default 42),
 * zero-filled the same way as `dailyVolume` — always the SAME set of day
 * keys as `dailyVolume` for the same `days`/`now`, so the two charts share an
 * x-range exactly as the design contract requires (never a combo chart). */
export function dailyAccuracy(attempts: AttemptRow[], days: number = 42, now: Date = new Date()): DayAccuracy[] {
  const buckets = new Map<string, { correct: number; total: number }>();
  for (const a of attempts) {
    const k = localDayKey(a.at);
    const b = buckets.get(k) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (isCorrectAttempt(a.grade)) b.correct += 1;
    buckets.set(k, b);
  }
  return dayRange(days, now).map((date) => {
    const b = buckets.get(date);
    if (!b || b.total === 0) return { date, correct: 0, total: 0, accuracy: null };
    return { date, correct: b.correct, total: b.total, accuracy: b.correct / b.total };
  });
}

/** Correct/total/accuracy over a trailing window, collapsed to one triple —
 * the headline "accuracy last 7 days" tile's engine (default 7 days).
 * Shares `isCorrectAttempt`'s convention; `accuracy: null` iff no attempts
 * fall in the window, same non-zero-misread rule as `DayAccuracy`. */
export function accuracyInWindow(
  attempts: AttemptRow[],
  days: number = 7,
  now: Date = new Date()
): { correct: number; total: number; accuracy: number | null } {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  let correct = 0;
  let total = 0;
  for (const a of attempts) {
    if (new Date(a.at).getTime() < cutoff) continue;
    total += 1;
    if (isCorrectAttempt(a.grade)) correct += 1;
  }
  return { correct, total, accuracy: total === 0 ? null : correct / total };
}

// ── Form 4: Mastery growth (step line, single series) ────────────────────

export interface MasteryGrowthPoint {
  date: string; // the local day this cumulative count was reached
  cumulative: number;
}

/** Cumulative units mastered over time, from `mastered_at` — a step-line
 * spine, one point per distinct day a mastery landed (same-day masteries
 * collapse to that day's final cumulative count; a 24-mastery day like
 * 2026-08-18 in the sampled data does not emit 24 separate points). Rows
 * with `status !== "mastered"` or a null `mastered_at` are excluded — same
 * "graduation event" reading `PathPanel`/`Graduation.tsx` use. Caller decides
 * scope: pass every course's progress rows for one global curve, or
 * pre-filter to one course's `unit_id`s (via `lr_unit.course_id`) for a
 * per-course curve — this function has no course knowledge of its own. */
export function masteryGrowth(
  progressRows: Array<Pick<LrUnitProgress, "status" | "mastered_at">>
): MasteryGrowthPoint[] {
  const masteredAt = progressRows
    .filter((r): r is Pick<LrUnitProgress, "status" | "mastered_at"> & { mastered_at: string } => r.status === "mastered" && !!r.mastered_at)
    .map((r) => r.mastered_at)
    .sort();

  const points: MasteryGrowthPoint[] = [];
  let cumulative = 0;
  let lastDate: string | null = null;
  for (const at of masteredAt) {
    cumulative += 1;
    const date = localDayKey(at);
    if (date === lastDate) {
      points[points.length - 1].cumulative = cumulative;
    } else {
      points.push({ date, cumulative });
      lastDate = date;
    }
  }
  return points;
}

// ── Headline tile: units mastered per course (X/total) ──────────────────

export interface CourseMasteryTile {
  courseId: number;
  mastered: number;
  total: number;
}

/**
 * Per-course "X/total units mastered" breakdown. `lr_unit_progress` carries
 * no `course_id` of its own — the join goes through `unitCourseRows`
 * (`lr_unit.unit_id, lr_unit.course_id`, unscoped — see `api.fetchUnitCourseMap`).
 * A unit with `course_id: null` (shouldn't exist in practice, but the column
 * is nullable per `LrUnit`) is excluded from every course's total rather
 * than silently inflating one.
 */
export function masteryByCourse(
  progressRows: Array<Pick<LrUnitProgress, "unit_id" | "status">>,
  unitCourseRows: Array<{ unit_id: number; course_id: number | null }>
): CourseMasteryTile[] {
  const courseOfUnit = new Map<number, number>();
  for (const u of unitCourseRows) {
    if (u.course_id != null) courseOfUnit.set(u.unit_id, u.course_id);
  }

  const totals = new Map<number, number>();
  for (const courseId of courseOfUnit.values()) {
    totals.set(courseId, (totals.get(courseId) ?? 0) + 1);
  }

  const mastered = new Map<number, number>();
  for (const p of progressRows) {
    if (p.status !== "mastered") continue;
    const courseId = courseOfUnit.get(p.unit_id);
    if (courseId == null) continue;
    mastered.set(courseId, (mastered.get(courseId) ?? 0) + 1);
  }

  return Array.from(totals.entries())
    .map(([courseId, total]) => ({ courseId, total, mastered: mastered.get(courseId) ?? 0 }))
    .sort((a, b) => a.courseId - b.courseId);
}

// ── Form 5: Per lens (small multiples) ───────────────────────────────────

export interface LensFacetStat {
  lens: Lens;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

/**
 * One facet per lens in `lensOrder` (the active course's own lens set —
 * `courses.ts`'s `CourseDef.lensOrder`), attempts/correct/accuracy tallied
 * from whatever `attempts` the caller passed in. Caller must pre-scope
 * `attempts` to the active course first (via `courseOfItemRef`) — this
 * function only groups by `lens`, it does not know what course it's looking
 * at. An attempt with `lens: null` (Infinite-exercises items, most Sprint
 * drills) contributes to no facet — deliberate: identity here comes from the
 * lens chip, not an inferred bucket. Facets are returned in `lensOrder`
 * (chip display order), including lenses with zero attempts (`accuracy:
 * null`) so a small-multiples grid never silently drops a lens that simply
 * hasn't been practiced yet.
 */
export function perLens(attempts: AttemptRow[], lensOrder: Lens[]): LensFacetStat[] {
  const buckets = new Map<Lens, { attempts: number; correct: number }>();
  for (const lens of lensOrder) buckets.set(lens, { attempts: 0, correct: 0 });
  for (const a of attempts) {
    if (a.lens === null) continue;
    const b = buckets.get(a.lens);
    if (!b) continue; // lens outside this course's own set — not this facet grid's concern
    b.attempts += 1;
    if (isCorrectAttempt(a.grade)) b.correct += 1;
  }
  return lensOrder.map((lens) => {
    const b = buckets.get(lens)!;
    return { lens, attempts: b.attempts, correct: b.correct, accuracy: b.attempts === 0 ? null : b.correct / b.attempts };
  });
}

// ── Form 6: Sprint buckets (horizontal bars, weakest first) ─────────────

/**
 * `lr_sprint_bucket_stats` rows, weakest-first — the SAME idiom
 * `AggregateTestSession.tsx`'s `sortWeakestFirst` uses for its own report
 * (lowest correct/total ratio first, ties broken by MORE evidence first —
 * a 4/8 bucket is a more trustworthy "weak" reading than a 1/2 bucket at the
 * same ratio). Buckets with zero attempts carry no ratio to rank by and are
 * dropped — this is a REPORT of demonstrated weakness, not the practice
 * queue's own never-practiced-first ordering (`SprintPanel.tsx`/
 * `SprintSession.tsx` already own that, separately, for picking what to
 * practice next).
 */
export function sprintWeakestBuckets(buckets: SprintBucketStat[]): SprintBucketStat[] {
  return buckets
    .filter((b) => b.attempts > 0)
    .slice()
    .sort((a, b) => {
      const ra = a.correct / a.attempts;
      const rb = b.correct / b.attempts;
      if (ra !== rb) return ra - rb;
      return b.attempts - a.attempts;
    });
}

// ── Form 7: Weakest concepts (horizontal bars, top 10) ───────────────────

export interface WeakConceptStat {
  conceptId: string;
  title: string;
  mean: number; // alpha/(alpha+beta)
  evidence: number; // alpha+beta
}

/**
 * Top `limit` (default 10) weakest concepts by `alpha/(alpha+beta)`, among
 * concepts with at least `minEvidence` (default 3, per the task's evidence
 * floor) combined alpha+beta — a concept touched once or twice hasn't earned
 * a confident "weak" reading yet, and would otherwise crowd out concepts
 * with real, repeated wrong-answer evidence. Ties broken by MORE evidence
 * first, same idiom as `sprintWeakestBuckets`/`AggregateTestSession`'s
 * `sortWeakestFirst`. A concept missing from `titles` falls back to its own
 * `concept_id` — `lr_concept` should always have a matching row, but a
 * missing title must never crash the chart or vanish the bar silently.
 */
export function weakestConcepts(
  memoryRows: Array<Pick<LrMemoryState, "concept_id" | "value_alpha" | "value_beta">>,
  titles: Record<string, string>,
  minEvidence: number = 3,
  limit: number = 10
): WeakConceptStat[] {
  return memoryRows
    .map((r) => ({
      conceptId: r.concept_id,
      title: titles[r.concept_id] ?? r.concept_id,
      mean: r.value_alpha / (r.value_alpha + r.value_beta),
      evidence: r.value_alpha + r.value_beta,
    }))
    .filter((r) => r.evidence >= minEvidence)
    .sort((a, b) => {
      if (a.mean !== b.mean) return a.mean - b.mean;
      return b.evidence - a.evidence;
    })
    .slice(0, limit);
}

// ── Form 8: Activity (calendar heatmap) ──────────────────────────────────

export interface ActivityDay {
  date: string;
  count: number;
  /** 0=Monday … 6=Sunday (Danish week start) — the heatmap grid's row index. */
  dow: number;
}

/** Attempts per local day over the trailing `weeks` (default 6), zero-filled
 * — a flat day list, not pre-shaped into a week×weekday grid, so the caller
 * picks its own layout (columns-per-week, right-to-left, etc.) off `dow`. */
export function activityCalendar(attempts: AttemptRow[], weeks: number = 6, now: Date = new Date()): ActivityDay[] {
  return dailyVolume(attempts, weeks * 7, now).map((d) => ({ ...d, dow: mondayIndex(d.date) }));
}

// ── Headline tiles ────────────────────────────────────────────────────────

export interface HeadlineTiles {
  totalAttempts: number;
  accuracy7d: { correct: number; total: number; accuracy: number | null };
  /** Count of distinct concepts with ANY memory-state evidence — "concepts
   * tracked", not a stricter mastery bar (that's `weakestConcepts`'
   * job on the other end of the same data). One `lr_memory_state` row per
   * concept, so this is simply `memoryRows.length`. */
  conceptsRetained: number;
  /** `null` means "no verdict has ever been computed" (`lr_learn_state`
   * missing row) — NEVER "0-day streak". Mirrors `api.fetchLearnState`'s
   * documented invariant; render "ukendt"/"—", not "0", on null. */
  streakDays: number | null;
  masteryByCourse: CourseMasteryTile[];
}

/**
 * Composes the five headline stat tiles from already-fetched rows — no I/O.
 * `attempts`/`memoryRows`/`progressRows` are the GLOBAL (all-course) sets;
 * `unitCourseRows` is `lr_unit`'s own `(unit_id, course_id)` pairs (see
 * `masteryByCourse`). `learnState` is passed through as-is (possibly `null`)
 * so the streak tile can honor the "missing row = unknown" invariant without
 * this function inventing its own default.
 */
export function headlineTiles(params: {
  attempts: AttemptRow[];
  memoryRows: Array<Pick<LrMemoryState, "concept_id">>;
  progressRows: Array<Pick<LrUnitProgress, "unit_id" | "status">>;
  unitCourseRows: Array<{ unit_id: number; course_id: number | null }>;
  learnState: Pick<LrLearnState, "streak_days"> | null;
  now?: Date;
}): HeadlineTiles {
  const { attempts, memoryRows, progressRows, unitCourseRows, learnState, now = new Date() } = params;
  return {
    totalAttempts: attempts.length,
    accuracy7d: accuracyInWindow(attempts, 7, now),
    conceptsRetained: memoryRows.length,
    streakDays: learnState ? (learnState.streak_days ?? null) : null,
    masteryByCourse: masteryByCourse(progressRows, unitCourseRows),
  };
}

// ── Optional: Lynudfordring best score (not one of the 8 pinned forms, but
// `lr_challenge_run` is in the fetched data set — a trivial reduction over
// it in case the board wants a "best Lynudfordring score" callout). ───────

export interface ChallengeRunSummary {
  score: number;
  correct: number;
  total: number;
  bestStreak: number | null;
  at: string;
}

/** The highest-scoring run in `runs`, or `null` if `runs` is empty. */
export function bestChallengeRun(
  runs: Array<{ score: number; correct: number; total: number; best_streak: number | null; at?: string }>
): ChallengeRunSummary | null {
  if (runs.length === 0) return null;
  const best = runs.reduce((a, b) => (b.score > a.score ? b : a));
  return { score: best.score, correct: best.correct, total: best.total, bestStreak: best.best_streak, at: best.at ?? "" };
}
