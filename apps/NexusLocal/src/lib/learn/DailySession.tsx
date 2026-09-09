/**
 * The card runner for "Dagens lektion" — LEARN_PLAN.md "Dagens lektion — daily
 * course-oriented lessons (pinned, 2026-09-09)".
 *
 * Fullscreen, thumb-first, one card at a time, reusing the Player's overlay
 * shell and reading column so a daily card sits in exactly the same optical
 * frame as a unit drill.
 *
 * ── Two interaction shapes, and the split is pedagogical ────────────────────
 *
 *   `read` — exposure. Statement on screen, one button: **Videre**. There is no
 *     grading here on purpose (see `daily.applyExposure`): a card whose whole
 *     interaction is "read this" demonstrates nothing, and grading it would
 *     inflate the competence estimate that decides when the concept comes back.
 *
 *   `recall` / `cloze` / `link` — retrieval. Prompt, then **Vis svar**, then a
 *     four-way self-grade. The reveal is a separate step and cannot be skipped
 *     past: a self-graded card where the answer was visible while thinking is
 *     not a memory measurement, it is a vibe.
 *
 * ── Resume is by card id, not by index ─────────────────────────────────────
 *
 * The session opens at the first card NOT already in `lr_attempt_log` for
 * today. An index would be wrong the moment the same lesson is picked up on the
 * other device — and the whole reason the lesson is a stored row is that it is
 * the same lesson everywhere.
 *
 * ⚠️ A card is marked done when its write RESOLVES, not when it is answered.
 * Advancing optimistically and letting the write fail silently would show a
 * finished day whose attempts were never recorded — which also means no streak,
 * no memory update, and no way to tell afterwards. Failures surface on the card
 * and the card stays.
 */

import { useEffect, useMemo, useState } from "react";
import { Markdown } from "./Markdown";
import { PLAYER_STYLE, READING_COL } from "./player/tokens";
import {
  fetchCompletedCardIds,
  gradeDailyCard,
  setLessonStatus,
  type DailyCard,
  type DailyLesson,
} from "./daily";
import type { Grade } from "./types";

const GRADES: Array<{ grade: Grade; label: string; tone: string }> = [
  { grade: 0, label: "Vidste ikke", tone: "bg-black/[0.06] text-[#1A1A24]/75" },
  { grade: 1, label: "Svært", tone: "bg-amber-100 text-amber-900" },
  { grade: 2, label: "OK", tone: "bg-emerald-100 text-emerald-900" },
  { grade: 3, label: "Let", tone: "bg-emerald-500 text-white" },
];

const KIND_LABEL: Record<DailyCard["kind"], string> = {
  read: "Læs",
  recall: "Genkald",
  cloze: "Udfyld",
  link: "Sammenhæng",
};

export function DailySession({
  lesson,
  onClose,
  onProgress,
}: {
  lesson: DailyLesson;
  onClose: () => void;
  onProgress: (doneIds: Set<string>) => void;
}) {
  const [done, setDone] = useState<Set<string> | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume: open at the first card with no attempt logged today.
  useEffect(() => {
    let alive = true;
    (async () => {
      let ids: Set<string>;
      try {
        ids = await fetchCompletedCardIds(lesson.lesson_date);
      } catch {
        // A failed progress read must not block the session — it degrades to
        // "start from the top", never to a blank screen.
        ids = new Set();
      }
      if (!alive) return;
      setDone(ids);
      const first = lesson.cards.findIndex((c) => !ids.has(c.id));
      setIndex(first === -1 ? lesson.cards.length : first);
    })();
    return () => {
      alive = false;
    };
  }, [lesson.lesson_date, lesson.cards]);

  const total = lesson.cards.length;
  const completed = done?.size ?? 0;
  const card = index < total ? lesson.cards[index] : null;
  const finished = done != null && index >= total;
  // A statement card's prompt IS its topic code, already shown as a chip.
  const hasHeading = !!card && !!card.prompt && card.prompt !== card.topic;

  const advance = useMemo(
    () => (cardId: string) => {
      setDone((prev) => {
        const next = new Set(prev ?? []);
        next.add(cardId);
        onProgress(next);
        return next;
      });
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [onProgress],
  );

  async function submit(grade: Grade) {
    if (!card || saving) return;
    setSaving(true);
    setError(null);
    try {
      await gradeDailyCard(lesson.lesson_date, card, grade);
      // Best-effort: the status flag is a convenience for the panel, and the
      // attempt log above is the real record — so a failure here is swallowed.
      if (index === 0) setLessonStatus(lesson.lesson_date, "in_progress").catch(() => {});
      if (index === total - 1) setLessonStatus(lesson.lesson_date, "done").catch(() => {});
      advance(card.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke gemme");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 text-[#1A1A24] backdrop-blur-xl">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
              aria-label="Luk"
            >
              ✕
            </button>
            <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">Dagens lektion</span>
            {!finished && (
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E78]">
                {Math.min(index + 1, total)} / {total}
              </span>
            )}
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-black/[0.07]">
            <span
              className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
              style={{ width: `${total === 0 ? 0 : (Math.min(index, total) / total) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className={READING_COL}>
          {done == null && <p className="text-center text-[13px] text-[#6E6E78]/70">Henter…</p>}

          {finished && (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              <div className="text-4xl">✓</div>
              <h3 className="text-[17px] font-semibold">Dagens lektion er færdig</h3>
              <p className="max-w-[24rem] text-[13px] leading-relaxed text-[#6E6E78]">
                {completed} kort gennemført. Morgendagens lektion beregnes automatisk —
                den bygger videre på det, du lige svarede.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 min-h-[44px] rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-6 text-[15px] font-semibold text-white active:scale-[0.985]"
              >
                Luk
              </button>
            </div>
          )}

          {card && (
            <article className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[#1A1A24]/[0.06] px-2 py-0.5 text-[11px] font-medium text-[#1A1A24]/75">
                  {card.course}
                </span>
                <span className="rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-[#6E6E78]">
                  {card.topic}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-[#6E6E78]/75">
                  {KIND_LABEL[card.kind]}
                </span>
                <span className="ml-auto text-[10px] text-[#6E6E78]/60">{card.why}</span>
              </div>

              <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:p-6">
                {/* A statement card's prompt is its topic code, which the chip
                    above already shows — repeating it would be a heading that
                    says nothing. */}
                {hasHeading && (
                  <Markdown className="text-[16px] leading-relaxed">{card.prompt}</Markdown>
                )}

                {card.kind === "read" && (
                  // The rule separates a heading from its body; with no heading
                  // it is a line above nothing.
                  <div className={hasHeading ? "mt-3 border-t border-black/[0.06] pt-3" : ""}>

                    <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/90">
                      {card.answer}
                    </Markdown>
                  </div>
                )}

                {card.kind !== "read" && revealed && (
                  <div className="mt-4 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-600/15">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-800/70">
                      {card.kind === "cloze" ? "Manglede" : "Svar"}
                    </div>
                    <Markdown className="text-[15px] leading-relaxed text-emerald-950">
                      {card.answer}
                    </Markdown>
                  </div>
                )}

                {card.source_ref && (
                  <div className="mt-3 font-mono text-[10px] text-[#6E6E78]/55">{card.source_ref}</div>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-800 ring-1 ring-red-600/15">
                  {error} — kortet er ikke gemt, prøv igen.
                </div>
              )}

              {card.kind === "read" ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => submit(2)}
                  className="min-h-[48px] w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 text-[15px] font-semibold text-white disabled:opacity-60 active:scale-[0.985]"
                >
                  {saving ? "Gemmer…" : "Videre"}
                </button>
              ) : !revealed ? (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="min-h-[48px] w-full rounded-xl bg-[#1A1A24] text-[15px] font-semibold text-white active:scale-[0.985]"
                >
                  Vis svar
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {GRADES.map((g) => (
                    <button
                      key={g.grade}
                      type="button"
                      disabled={saving}
                      onClick={() => submit(g.grade)}
                      className={`min-h-[48px] rounded-xl text-[14px] font-semibold disabled:opacity-60 active:scale-[0.985] ${g.tone}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
