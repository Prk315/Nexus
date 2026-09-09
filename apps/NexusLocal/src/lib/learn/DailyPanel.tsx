/**
 * "Dagens lektion" — the first thing on the Learn page, and the one surface
 * that is about TODAY rather than about a course.
 * See LEARN_PLAN.md "Dagens lektion — daily course-oriented lessons (pinned,
 * 2026-09-09)".
 *
 * ⚠️ It sits ABOVE the course switcher and is deliberately NOT course-scoped.
 * Every other panel on this page answers "where am I in this course"; a daily
 * lesson answers "what should I do now", and the honest answer spans all three
 * enrolled courses at once. Scoping it to the selected course would mean the
 * assignment due tomorrow disappears the moment you tap another course — the
 * one moment it must not.
 *
 * ── The three states must look different ───────────────────────────────────
 *
 *   lesson === undefined  loading
 *   lesson === null       NO LESSON COMPUTED. Not "nothing to do".
 *   lesson !== null       a day, with the reasoning behind it on screen.
 *
 * The middle one is the `blocking_state` doctrine again: `lr_daily_lesson` is
 * never seeded, and `learn-daily` refuses to write an empty lesson, precisely so
 * "the generator has not run" and "you are finished" cannot be confused. A
 * green tick over a day nobody computed is the failure this whole system is
 * built to avoid — it looks exactly like success.
 *
 * ── Why the rationale is on the card, not hidden ───────────────────────────
 *
 * Each course shows its phase, its chapter window, and the graded event that
 * pulled it up ("Home Assignment 1 om 1 dag"). A daily system that cannot say
 * why today is MLA-heavy is a black box, and a black box gets ignored inside a
 * week — the learner has no way to tell a good pick from a stale one.
 */

import { useCallback, useEffect, useState } from "react";
import {
  countsByCourse,
  fetchCompletedCardIds,
  fetchDailyLesson,
  PHASE_LABEL,
  remainingMinutes,
  todayLocal,
  type DailyLesson,
} from "./daily";
import { DailySession } from "./DailySession";

export function DailyPanel() {
  // undefined = loading, null = no lesson computed (NOT "nothing due").
  const [lesson, setLesson] = useState<DailyLesson | null | undefined>(undefined);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const date = todayLocal();
    try {
      const l = await fetchDailyLesson(date);
      setLesson(l);
      setFailed(false);
      if (l) {
        try {
          setDone(await fetchCompletedCardIds(date));
        } catch {
          setDone(new Set());
        }
      }
    } catch {
      // A failed read is UNKNOWN, same as a missing row — but it is a different
      // unknown, and saying so is the difference between "the server hasn't run"
      // and "this device can't reach it".
      setLesson(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = lesson?.cards.length ?? 0;
  const completed = lesson ? lesson.cards.filter((c) => done.has(c.id)).length : 0;
  const allDone = total > 0 && completed >= total;
  const minutes = lesson ? remainingMinutes(lesson.cards, done) : 0;

  return (
    <section className="flex flex-col gap-2 md:gap-3">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">
        Dagens lektion
      </h2>

      {lesson === undefined && (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Henter…
        </div>
      )}

      {lesson === null && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]/70">
            ?
          </span>
          <div className="min-w-0">
            <div className="text-[13px] text-[#1A1A24]/70">Ingen lektion beregnet endnu</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E6E78]/80">
              {failed ? (
                <>Kunne ikke hente dagens lektion. Det betyder <em className="not-italic text-[#1A1A24]/70">ikke</em>, at der ikke er noget at lave.</>
              ) : (
                <>Serveren har ikke lagt en lektion for i dag. Det betyder <em className="not-italic text-[#1A1A24]/70">ikke</em>, at du er færdig.</>
              )}
            </p>
          </div>
        </div>
      )}

      {lesson && (
        <>
          <div className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl md:p-5">
            <div className="flex items-end gap-3">
              <div>
                <div className="font-mono text-3xl font-semibold leading-none tabular-nums md:text-4xl">
                  <span
                    className={
                      allDone
                        ? "text-emerald-600"
                        : "bg-gradient-to-br from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent"
                    }
                  >
                    {completed}
                  </span>
                  <span className="text-[#6E6E78]/40">/{total}</span>
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/80">
                  kort i dag
                </div>
              </div>

              <div className="ml-auto text-right">
                <div className="font-mono text-2xl font-semibold leading-none tabular-nums text-[#1A1A24]/90 md:text-3xl">
                  {allDone ? "0" : minutes}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/80">
                  min tilbage
                </div>
              </div>
            </div>

            <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-black/[0.07]">
              <span
                className={`block h-full transition-[width] duration-500 ease-out ${
                  allDone ? "bg-emerald-500" : "bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                }`}
                style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {countsByCourse(lesson.cards).map(({ course, n }) => (
                <span
                  key={course}
                  className="rounded-md bg-[#1A1A24]/[0.05] px-2 py-0.5 text-[11px] text-[#1A1A24]/75"
                >
                  {course} · {n}
                </span>
              ))}
            </div>

            {/* Why today looks like this. */}
            <ul className="mt-3 flex flex-col gap-1 border-t border-black/[0.06] pt-3">
              {lesson.courses.map((c) => (
                <li key={c.c_id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed">
                  <span className="font-medium text-[#1A1A24]/80">{c.label}</span>
                  <span className="text-[#6E6E78]/80">
                    {PHASE_LABEL[c.phase]} · t.o.m. kap. {c.chapter_ceiling} · uge {c.teaching_week}
                  </span>
                  {c.urgency_reason && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                      {c.urgency_reason}
                    </span>
                  )}
                  {c.note && <span className="text-[10px] text-[#6E6E78]/60">{c.note}</span>}
                </li>
              ))}
            </ul>
          </div>

          {allDone ? (
            <button
              type="button"
              disabled
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-black/[0.05] px-3 py-2 text-[13px] text-[#1A1A24]/70 md:max-w-[26rem]"
            >
              Færdig for i dag ✓
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] md:max-w-[26rem]"
            >
              {completed > 0 ? `Fortsæt · ${total - completed} tilbage` : `Start · ${minutes} min`}
            </button>
          )}
        </>
      )}

      {open && lesson && (
        <DailySession
          lesson={lesson}
          onProgress={setDone}
          onClose={() => {
            setOpen(false);
            // Re-read rather than trusting the session's in-memory set: the
            // same lesson may have been advanced on the other device.
            void load();
          }}
        />
      )}
    </section>
  );
}
