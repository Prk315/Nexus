/**
 * Dagens lektion — the client half of the daily lesson system.
 * See LEARN_PLAN.md "Dagens lektion — daily course-oriented lessons (pinned,
 * 2026-09-09)" and `supabase/functions/learn-daily/index.ts`.
 *
 * ⚠️ This module **derives nothing**. The lesson — which concepts, which cards,
 * in which order, in what proportion per course — is decided entirely by the
 * `learn-daily` edge function and read from `lr_daily_lesson`. That is the same
 * rule the productivity stack states as "no client derives blocking policy",
 * and it exists for the same reason: a Mac, a phone and (later) a widget all
 * reading one row cannot disagree about what today is. A selector re-run in the
 * app would also re-roll the day on every mount — heat has decayed, an attempt
 * has landed — so a half-finished lesson could never be resumed.
 *
 * What the client owns is the other half: recording what happened. Grading a
 * card appends to `lr_attempt_log` and applies the α/β/heat update through
 * `memory.ts`'s existing port, exactly like Player/Review/Infinite do.
 *
 * ── Progress lives in the attempt log, not in the lesson row ────────────────
 *
 * "How far am I today" is derived by counting `lr_attempt_log` rows whose
 * `item_ref` starts with `daily:<date>:`. Two reasons, and neither is
 * aesthetic:
 *
 *   - Writing progress back into `lr_daily_lesson.cards` would be a
 *     read-modify-write on a jsonb array from two devices — the Mac and the
 *     phone would silently overwrite each other's ticks.
 *   - `learn-evaluate` already computes `streak_days` from the DAYS on which
 *     attempts exist. Logging each card there means finishing a daily lesson
 *     feeds the existing streak with no new code and no second definition of
 *     what a "study day" is.
 */

import { supabasePublic } from "../supabase";
import { nodeUserId } from "../nodeUser";
import { applyBlamePropagation, fetchMemoryStates, logAttempt, upsertMemory } from "./api";
import { applyGrade, decayHeat, defaultMemoryState, SPIKE_FACTOR } from "./memory";
import type { Grade, LrMemoryState } from "./types";

export type DailyCardKind = "read" | "recall" | "cloze" | "link";
export type DailyPhase = "prime" | "consolidate" | "maintain";

export interface DailyCard {
  id: string;
  kind: DailyCardKind;
  c_id: number;
  course: string;
  concept_id: string;
  title: string;
  topic: string;
  chapter: number;
  source_ref: string;
  /** Shown before the reveal. */
  prompt: string;
  /** Shown after the reveal. */
  answer: string;
  seconds: number;
  /** Short reason this card is here ("ny · kap. 2", "genopfriskning"). */
  why: string;
  blank?: string;
  prereq_id?: string;
  prereq_title?: string;
}

export interface DailyCourseVerdict {
  c_id: number;
  label: string;
  phase: DailyPhase;
  chapter_ceiling: number;
  teaching_week: number;
  quota: number;
  cards: number;
  gate: "strict" | "relaxed";
  urgency: number;
  urgency_reason: string | null;
  pool: { fresh: number; due: number; edges: number };
  note?: string;
}

export interface DailyLesson {
  user_id: string;
  lesson_date: string;
  status: "ready" | "in_progress" | "done";
  minutes_target: number;
  cards: DailyCard[];
  courses: DailyCourseVerdict[];
  generated_at: string;
  completed_at: string | null;
}

const TIMEZONE = "Europe/Copenhagen";

/**
 * Today's date in the SAME zone the edge function stamps rows with.
 *
 * ⚠️ Not `toISOString().slice(0, 10)` — that is UTC, so every evening after
 * 22:00 (23:00 in winter) the app would ask for tomorrow's lesson, find
 * nothing, and render "ingen lektion beregnet endnu" on a day that has one.
 */
export function todayLocal(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `item_ref` for one graded daily card. Parseable back to the card id. */
export function dailyItemRef(date: string, card: DailyCard): string {
  return `daily:${date}:${card.id}:${card.concept_id}`;
}

/**
 * Today's lesson, or `null` when none has been computed.
 *
 * ⚠️ `null` means UNKNOWN, never "nothing to study today" — `lr_daily_lesson`
 * is deliberately not seeded, and `learn-daily` refuses to write an empty
 * lesson precisely so the two states stay distinguishable. Callers must render
 * them differently; treating a missing row as "færdig ✓" is the same lie as an
 * inbox panel that has never run showing "Inbox zero".
 */
export async function fetchDailyLesson(date = todayLocal()): Promise<DailyLesson | null> {
  const { data, error } = await supabasePublic
    .from("lr_daily_lesson")
    .select("*")
    .eq("user_id", await nodeUserId())
    .eq("lesson_date", date)
    .maybeSingle();
  if (error) throw error;
  return (data as DailyLesson | null) ?? null;
}

/** Card ids already graded today, so a reopened session resumes where it stopped. */
export async function fetchCompletedCardIds(date = todayLocal()): Promise<Set<string>> {
  const { data, error } = await supabasePublic
    .from("lr_attempt_log")
    .select("item_ref")
    .eq("user_id", await nodeUserId())
    .like("item_ref", `daily:${date}:%`);
  if (error) throw error;
  const out = new Set<string>();
  for (const row of (data ?? []) as { item_ref: string }[]) {
    const parts = row.item_ref.split(":");
    if (parts.length >= 3) out.add(parts[2]);
  }
  return out;
}

export async function setLessonStatus(
  date: string,
  status: DailyLesson["status"],
): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_daily_lesson")
    .update({
      status,
      ...(status === "done" ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("user_id", await nodeUserId())
    .eq("lesson_date", date);
  if (error) throw error;
}

/**
 * A `read` card is EXPOSURE, not assessment — heat only, no evidence.
 *
 * ⚠️ It deliberately does not go through `applyGrade`. That function always
 * moves α or β, i.e. it records that the learner demonstrated something; a card
 * whose entire interaction is "here is the definition, tap Videre" demonstrates
 * nothing. Feeding it through the grading path would inflate competence for
 * every concept merely READ, and competence is exactly what decides when a
 * concept next comes back — so the review schedule would quietly stretch for
 * material never once retrieved.
 *
 * Heat is the right channel: it says "recently seen", it is what decays, and it
 * is what the retrieval card immediately afterwards then tests.
 */
function applyExposure(state: LrMemoryState, now: Date = new Date()): LrMemoryState {
  const nowIso = now.toISOString();
  const decayed = decayHeat(state.heat, state.last_decayed, now);
  return {
    ...state,
    heat: Math.min(decayed + (1.0 - decayed) * SPIKE_FACTOR, 1.0),
    last_reviewed: nowIso,
    last_decayed: nowIso,
  };
}

/**
 * Record one finished card: attempt log + memory update (+ blame propagation
 * on a failure, the DAG-v2 rule — a wrong answer is evidence against the
 * prerequisites too).
 *
 * `grade` is ignored for `read` cards, which take the exposure path above.
 * Blame is fire-and-forget for the same reason every other grading path in this
 * app does it that way: it is a refinement of the model, and a failed
 * propagation must not block the learner's next card.
 */
export async function gradeDailyCard(
  date: string,
  card: DailyCard,
  grade: Grade,
): Promise<void> {
  const userId = await nodeUserId();
  const states = await fetchMemoryStates([card.concept_id]);
  const current = states[card.concept_id] ?? defaultMemoryState(userId, card.concept_id);

  const next = card.kind === "read"
    ? applyExposure(current)
    // These courses carry no `tre-perspektiver` lens tags — the lens dimension
    // is Linear Algebra's. Passing null leaves `lens_counts` untouched rather
    // than inventing a lens the course does not have.
    : applyGrade(current, grade, null);

  await upsertMemory(next);
  await logAttempt({ itemRef: dailyItemRef(date, card), lens: null, grade });

  if (card.kind !== "read") {
    applyBlamePropagation([card.concept_id], grade).catch(() => {
      // Refinement only — never blocks the session.
    });
  }
}

/** Minutes the day's remaining cards are budgeted to take. */
export function remainingMinutes(cards: DailyCard[], done: Set<string>): number {
  const seconds = cards
    .filter((c) => !done.has(c.id))
    .reduce((sum, c) => sum + (c.seconds ?? 60), 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** Per-course counts for the panel's summary line. */
export function countsByCourse(cards: DailyCard[]): Array<{ course: string; n: number }> {
  const map = new Map<string, number>();
  for (const c of cards) map.set(c.course, (map.get(c.course) ?? 0) + 1);
  return Array.from(map, ([course, n]) => ({ course, n }));
}

export const PHASE_LABEL: Record<DailyPhase, string> = {
  prime: "forberedelse",
  consolidate: "konsolidering",
  maintain: "vedligehold",
};
