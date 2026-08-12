/**
 * A flashcard deck (schema v1.2, LEARN_PLAN.md "Flashcard decks"): entry
 * (before layer 1 — "Kend sætningerne") or exit (after the rapid round,
 * before the test — "Sig og anvend dem"). One card at a time, full attention,
 * the same rhythm `DrillCard.tsx` uses for a drill.
 *
 * Per-card lifecycle, owned by the inner `FlashcardCardView` (remounted per
 * card via `key={card.id}`, exactly like `DrillCard`'s own doc comment
 * describes for drills):
 *
 *   1. **Front** — `front_md` in generous type, centred. Tap the card (or the
 *      dock's "Flip card" button) to flip. The flip itself is a CSS 3D turn:
 *      the card wrapper rotates to 90° (edge-on, `perspective`+`rotateY`),
 *      the face is swapped at that invisible midpoint, then it un-rotates
 *      back to 0° revealing the new face. Content is never stacked
 *      front-over-back, so it stays correct at any KaTeX-driven height —
 *      the classic pitfall with a literal `backface-visibility` flip.
 *   2. **Back** — `back_md` (+ `note_md` on entry cards) replaces the dock's
 *      primary button with DrillCard's own 0–3 grade bar (same classes,
 *      duplicated here rather than imported — see the constants below).
 *      Grading calls `onGrade(card, grade)`, which `Player.tsx` has already
 *      bound to the deck's own weight (entry 0.7 / exit 1.0) and to
 *      `applyGrade`/`logAttempt`/`applyBlamePropagation`, fire-and-forget.
 *   3. **Check** (only if `card.check` exists) — appears in place, below the
 *      still-flipped card, the instant the card is graded. Option rendering
 *      is TestStep's `QuestionCard` verbatim (same classes): every option's
 *      `why_md` reveals on answer, staggered 60ms. Answering also calls
 *      `onCheckAnswered(card, correct)` — LEARN_PLAN.md: "MCQ correctness
 *      ALSO logs an attempt at the same weight, grade 2 correct / 1 wrong" —
 *      `Player.tsx` maps that grade for us; this file only reports
 *      correctness. A "Next card →" button appears once answered, mirroring
 *      `TestStep`'s "answer, read the rationale, then advance" pace rather
 *      than DrillCard's immediate auto-advance.
 *   4. A card with **no** `check` advances immediately on grading — the same
 *      "no confirm" rule DrillCard uses for drills.
 *
 * The outer `FlashcardStep` owns only the deck cursor (which card, resumed
 * from `solvedCardIds` exactly like `LayerStep`'s `firstUnsolved`) and the
 * deck-complete screen once every card has been graded — same shape as
 * `LayerStep`'s "layer complete" / `FinalRound`'s "round complete" cards.
 */

import { useState } from "react";
import type { EntryFlashcard, ExitFlashcard, Flashcard, Grade, UnitContent } from "../types";
import { Markdown } from "../Markdown";
import { LensChip } from "./TheoryCards";
import { ANSWER_COL, CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, READING_COL } from "./tokens";

// Duplicated from `DrillCard.tsx` rather than imported — `player/` files are
// independent slices (LEARN_PLAN.md's "one agent per slice, no cross-edits"),
// and this is four short literal-class arrays, not shared logic. Keep byte-
// identical with DrillCard's if that file's grade bar is ever restyled.
const GRADE_LABEL = ["Again", "Hard", "Good", "Easy"] as const;
const GRADE_CLASS = [
  "bg-black/[0.03] ring-1 ring-red-500/25 text-[#1A1A24]/70",
  "bg-gradient-to-br from-indigo-500/15 to-fuchsia-600/15 text-[#1A1A24]/75 ring-1 ring-black/[0.04]",
  "bg-gradient-to-br from-indigo-500/40 to-fuchsia-600/40 text-[#1A1A24]/90",
  "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white",
] as const;
const GRADE_NUM_CLASS = ["text-[#1A1A24]/35", "text-[#1A1A24]/35", "text-[#1A1A24]/40", "text-white/70"] as const;

const KIND_LABEL: Record<"recall" | "apply", string> = { recall: "RECALL", apply: "APPLY" };

/** First card this user hasn't graded yet, so re-entering a deck resumes forward. */
function firstUnsolved(cards: Flashcard[], solved: Set<string>): number {
  const i = cards.findIndex((c) => !solved.has(c.id));
  return i === -1 ? 0 : i;
}

function FlashcardCardView({
  content,
  card,
  deckKind,
  header,
  indexLabel,
  onGraded,
  onCheckAnswered,
  onDone,
}: {
  content: UnitContent;
  card: Flashcard;
  deckKind: "entry" | "exit";
  header: string;
  indexLabel: string;
  onGraded: (card: Flashcard, grade: Grade) => void;
  onCheckAnswered: (card: Flashcard, correct: boolean) => void;
  onDone: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [turning, setTurning] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [checkSelected, setCheckSelected] = useState<number | null>(null);

  // Inherit the anchored theory box's own perspective when the card carries
  // no lens of its own (LEARN_PLAN.md's schema comment: "null // inherit the
  // theory box's perspective").
  const lens = card.lens ?? content.theory.find((t) => t.concept_id === card.concept_id)?.perspective ?? null;

  function flip() {
    if (grade !== null || turning) return; // locked once graded — the back is the graded record
    setTurning(true);
    window.setTimeout(() => {
      setFlipped((f) => !f);
      setTurning(false);
    }, 140);
  }

  function handleGradeTap(g: Grade) {
    setGrade(g);
    onGraded(card, g);
    if (!card.check) onDone(); // no check on this card — advance immediately, DrillCard's rule
  }

  function handleCheckSelect(i: number) {
    if (checkSelected !== null || !card.check) return;
    setCheckSelected(i);
    onCheckAnswered(card, card.check.options[i]?.correct === true);
  }

  const showGradeBar = flipped && !turning && grade === null;
  const showCheck = grade !== null && !!card.check;
  const exitKind = "kind" in card ? card.kind : null;

  return (
    <>
      <main className={`${MAIN_SHELL} pb-48`}>
        <div className={READING_COL}>
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-[#6E6E78]">
            <span className="flex items-center gap-2">
              <span>{header}</span>
              {exitKind && (
                <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-[#6E6E78]">
                  {KIND_LABEL[exitKind]}
                </span>
              )}
            </span>
            <span className="tabular-nums">{indexLabel}</span>
          </div>

          {/* The flip card. `[perspective]` on the outer, `rotateY` on the
              inner — a single face is ever rendered, swapped at the 90°
              midpoint (see file header), so variable-height KaTeX content
              never needs the two-faces-stacked trick. */}
          <div
            role="button"
            tabIndex={0}
            aria-label={flipped ? "Flip back to the front" : "Flip to see the answer"}
            onClick={flip}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                flip();
              }
            }}
            className="relative mt-2 [perspective:1200px] md:mt-4"
          >
            <div
              className={`transition-transform duration-150 ease-in [transform-style:preserve-3d] motion-reduce:transition-none ${
                turning ? "[transform:rotateY(90deg)]" : "[transform:rotateY(0deg)]"
              } ${grade === null ? "cursor-pointer" : ""}`}
            >
              {!flipped ? (
                <div
                  className={`flex min-h-[15rem] flex-col items-center justify-center gap-3 p-6 text-center md:min-h-[20rem] md:p-12 ${CARD}`}
                >
                  {lens && <LensChip lens={lens} />}
                  <Markdown className="text-[19px] font-semibold leading-snug text-[#1A1A24]/90 md:text-[27px]">
                    {card.front_md}
                  </Markdown>
                  {grade === null && (
                    <span className="mt-1 text-[10px] uppercase tracking-wide text-[#6E6E78]/45">Tap to flip</span>
                  )}
                </div>
              ) : (
                <div className={`flex min-h-[15rem] flex-col p-5 md:min-h-[20rem] md:p-10 ${CARD}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-wide text-[#6E6E78]/60">Answer</p>
                    {lens && <LensChip lens={lens} />}
                  </div>
                  <Markdown className="mt-2 text-[16px] leading-relaxed text-[#1A1A24]/85 md:mt-4 md:text-[19px]">
                    {card.back_md}
                  </Markdown>
                  {"note_md" in card && card.note_md && (
                    <div className="mt-4 border-t border-black/[0.06] pt-3">
                      <Markdown className="text-[13px] italic leading-relaxed text-[#6E6E78]">
                        {card.note_md}
                      </Markdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {showCheck && card.check && (
            <div className="mt-4 md:mt-6">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-[#6E6E78]">
                {deckKind === "entry" ? "Understanding check" : "Apply it"}
              </p>
              {/* Option rendering = TestStep.tsx's QuestionCard verbatim, incl.
                  the staggered why_md reveal — LEARN_PLAN.md: "reuse TestStep's
                  option rendering with why_md reveal". */}
              <div className={`${CARD} p-3 md:p-8`}>
                <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/85 md:text-[16.5px]">
                  {card.check.prompt_md}
                </Markdown>
                <div className={`mt-3 flex flex-col gap-2 md:mt-6 ${ANSWER_COL}`}>
                  {card.check.options.map((opt, i) => {
                    const answered = checkSelected !== null;
                    const isChosen = checkSelected === i;
                    let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
                    if (answered) {
                      if (opt.correct) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
                      else if (isChosen) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
                      else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
                    }
                    return (
                      <div key={i}>
                        <button
                          type="button"
                          disabled={answered}
                          onClick={() => handleCheckSelect(i)}
                          className={`min-h-[44px] w-full rounded-xl border px-3 py-3 text-left text-[14px] transition-colors ${stateClass}`}
                        >
                          <Markdown className="inline">{opt.body_md}</Markdown>
                        </button>
                        {answered && opt.why_md && (
                          <div
                            className="grid animate-[learn-step-in_.2s_ease-out] grid-rows-[1fr]"
                            style={{ animationDelay: `${i * 60}ms` }}
                          >
                            <div className="overflow-hidden">
                              <div
                                className={`px-3 pb-1 pt-1.5 text-[12px] leading-relaxed ${
                                  opt.correct ? "text-emerald-700/80" : isChosen ? "text-red-700/80" : "text-[#6E6E78]/80"
                                }`}
                              >
                                <Markdown className="text-[12px] leading-relaxed">{opt.why_md}</Markdown>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {!flipped && grade === null && (
            <button
              type="button"
              onClick={flip}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              Flip card
            </button>
          )}

          {showGradeBar && (
            <div className="flex gap-1.5">
              {GRADE_LABEL.map((label, g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handleGradeTap(g as Grade)}
                  className={`flex-1 rounded-xl py-3 text-[12px] font-medium transition-transform active:scale-[0.97] ${GRADE_CLASS[g]}`}
                >
                  <span className={`block text-[10px] uppercase tracking-wide ${GRADE_NUM_CLASS[g]}`}>{g}</span>
                  {label}
                </button>
              ))}
            </div>
          )}

          {showCheck && checkSelected !== null && (
            <button
              type="button"
              onClick={onDone}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              Next card →
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

export function FlashcardStep({
  content,
  cards,
  deckKind,
  header,
  solvedCardIds,
  advanceLabel,
  advanceDisabled,
  advanceHint,
  onGrade,
  onCheckAnswered,
  onAdvance,
}: {
  content: UnitContent;
  cards: EntryFlashcard[] | ExitFlashcard[];
  deckKind: "entry" | "exit";
  /** "Kend sætningerne" (entry) · "Sig og anvend dem" (exit) — LEARN_PLAN.md. */
  header: string;
  solvedCardIds: Set<string>;
  /** What the next step is, phrased for the dock: "Layer 1 →", "Test →", … */
  advanceLabel: string;
  /** Only ever true for "the next step is the test and it is still locked". */
  advanceDisabled?: boolean;
  advanceHint?: string;
  onGrade: (card: Flashcard, grade: Grade) => void;
  onCheckAnswered: (card: Flashcard, correct: boolean) => void;
  onAdvance: () => void;
}) {
  const deck = cards as Flashcard[];
  const [idx, setIdx] = useState(() => firstUnsolved(deck, solvedCardIds));
  // Starts false even when resuming on the deck's last card — that card
  // still needs to be graded before the completion screen shows. An empty
  // deck (shouldn't happen — Player.tsx only mounts this step when the deck
  // is non-empty) falls straight through via the `idx >= deck.length` guard
  // below, not this flag.
  const [done, setDone] = useState(false);

  const solvedHere = deck.filter((c) => solvedCardIds.has(c.id)).length;

  if (!done && idx < deck.length) {
    const card = deck[idx];
    return (
      <FlashcardCardView
        key={card.id}
        content={content}
        card={card}
        deckKind={deckKind}
        header={header}
        indexLabel={`${idx + 1} / ${deck.length}`}
        onGraded={onGrade}
        onCheckAnswered={onCheckAnswered}
        onDone={() => {
          if (idx + 1 < deck.length) setIdx((n) => n + 1);
          else setDone(true);
        }}
      />
    );
  }

  return (
    <>
      <main className={`${MAIN_SHELL} pb-40`}>
        <div className={`${READING_COL} md:max-w-[32rem]`}>
          <div className={`${CARD} p-4 text-center md:p-8`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">{header}</p>
            <p className="mt-2 text-[15px] font-medium text-[#1A1A24]/85 md:text-[17px]">
              {deck.length > 0 ? `${solvedHere}/${deck.length} cards graded.` : "Nothing in this deck."}
            </p>
            {/* Deck progress dots — one per card, gradient once graded, a
                hollow ring on the (already-passed) current position, faint
                otherwise. */}
            {deck.length > 0 && (
              <div className="mx-auto mt-3 flex max-w-[22rem] flex-wrap items-center justify-center gap-1.5">
                {deck.map((c) => (
                  <span
                    key={c.id}
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      solvedCardIds.has(c.id) ? "bg-gradient-to-br from-indigo-500 to-fuchsia-600" : "bg-black/[0.1]"
                    }`}
                  />
                ))}
              </div>
            )}
            {advanceHint && <p className="mt-2 text-[12px] text-[#6E6E78] md:mt-3 md:text-[13px]">{advanceHint}</p>}
          </div>
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {deck.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIdx(0);
                setDone(false);
              }}
              className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
            >
              Go through this deck again
            </button>
          )}
          <button
            type="button"
            onClick={onAdvance}
            disabled={advanceDisabled}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
          >
            {advanceLabel}
          </button>
        </div>
      </footer>
    </>
  );
}
