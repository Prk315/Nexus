/**
 * One drill, full attention (`Player.tsx` §3.5). Owns its own check/hint/
 * solution/grade flow; every caller (`LayerStep.tsx`, `FinalRound.tsx`,
 * `ReviewSession.tsx`) remounts a fresh instance per drill via
 * `key={drill.id}` rather than resetting state itself.
 *
 * `text`-type drills are self-graded (`answers.checkText` always returns
 * `null`): the "Check" button reads "Show solution" and there is no
 * right/wrong banner, only the grade bar — 6 of 14 drills in real content
 * take this path (DESIGN.md §3.5).
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. The grade bar's
 * lower steps (Again/Hard/Good) swap from white-on-tint to ink-on-tint —
 * white text over a 15–35%-opacity gradient blended onto white card stock is
 * unreadable; only the fully-saturated "Easy" step keeps white text.
 */

import { useEffect, useState } from "react";
import type { Archetype, Drill, Grade, Lens } from "../types";
import { checkAnswer, checkTilesBuild, checkTilesSelect, inputParses } from "../answers";
import { Markdown } from "../Markdown";
import { TileDrill } from "./TileDrill";
import {
  ANSWER_COL,
  CARD,
  DOCK_SHELL,
  DOCK_STACK,
  FEEDBACK,
  MAIN_SHELL,
  READING_COL,
  useLensTokens,
  useSolidBar,
  useTranslateBar,
} from "./tokens";
import {
  Workspace,
  WorkspaceToggle,
  useWorkspaceLayout,
  scratchLineCount,
  WS_SPLIT_ROW,
  WS_SPLIT_MAIN,
  WS_PANE,
} from "./Workspace";

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  computational: "COMPUTATIONAL",
  translate: "TRANSLATE",
  truefalse: "TRUE/FALSE",
  conceptual: "CONCEPTUAL",
  tiles: "TILES",
};

const GRADE_LABEL = ["Again", "Hard", "Good", "Easy"] as const;
const GRADE_CLASS = [
  "bg-black/[0.03] ring-1 ring-red-500/25 text-[#1A1A24]/70",
  "bg-gradient-to-br from-indigo-500/15 to-fuchsia-600/15 text-[#1A1A24]/75 ring-1 ring-black/[0.04]",
  "bg-gradient-to-br from-indigo-500/40 to-fuchsia-600/40 text-[#1A1A24]/90",
  "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white",
] as const;
const GRADE_NUM_CLASS = ["text-[#1A1A24]/35", "text-[#1A1A24]/35", "text-[#1A1A24]/40", "text-white/70"] as const;

// Format-error copy for the three typed-input `answer_type`s that go through
// `inputParses` (answers.ts). choice/text/tiles never produce a format
// error — no typed parsing step exists for them, so they're omitted here.
const FORMAT_ERROR_MESSAGE: Record<"numeric" | "vector" | "matrix", string> = {
  numeric: "Kunne ikke læses som et tal — skriv fx 6, -2 eller 2/3",
  vector: "Kunne ikke læses som en vektor — skriv komponenterne adskilt med komma, fx 1, -2, 3",
  matrix: "Kunne ikke læses som en matrix — adskil rækker med semikolon, fx 1 2; 3 4",
};

// Only typed answer types get the Arbejdsrum workspace (LEARN_PLAN.md).
// choice/tiles keep today's layout byte-for-byte: with `ws === false` the
// wrapper below resolves to READING_COL + `display:contents`.
const WORKSPACE_TYPES = new Set(["numeric", "vector", "matrix", "text"]);

export function DrillCard({
  drill,
  archetype,
  indexLabel,
  translateFrom,
  onGraded,
}: {
  drill: Drill;
  archetype: Archetype;
  indexLabel: string;
  translateFrom?: Lens | null;
  onGraded: (grade: Grade) => void;
}) {
  const LENS = useLensTokens();
  const SOLID_BAR = useSolidBar();
  const TRANSLATE_BAR = useTranslateBar();
  const [input, setInput] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  // Doubles as both tile modes' state: an unordered selected-id set for
  // `select`, an ordered tapped-id sequence for `build` (TileDrill.tsx).
  const [tileSelection, setTileSelection] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  // Distinct from `result === false`: unparseable input never reaches
  // `checkAnswer`, logs no attempt, and leaves the drill unanswered — see
  // `inputParses` in answers.ts. Cleared on the next keystroke.
  const [formatError, setFormatError] = useState<string | null>(null);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [shaking, setShaking] = useState(false);
  const layout = useWorkspaceLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const ws = WORKSPACE_TYPES.has(drill.answer_type);
  const wsKey = `drill:${drill.id}`;
  /** Set to false to ship without the desktop answer relocation (the pane
   * then only carries scratch; the answer stays in the card). */
  const relocateAnswer = true;

  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(false), 340);
    return () => clearTimeout(t);
  }, [shaking]);

  const isText = drill.answer_type === "text";
  const hints = drill.hints ?? [];
  const gradeVisible = (isText && checked) || result === true || showSolution;

  const topBarClass =
    archetype === "translate" && translateFrom && translateFrom !== drill.lens
      ? TRANSLATE_BAR[`${translateFrom}-${drill.lens}`]
      : SOLID_BAR[drill.lens];

  function runCheck() {
    if (isText) {
      setChecked(true);
      setShowSolution(true);
      return;
    }
    if (drill.answer_type === "tiles") {
      const r =
        drill.mode === "build"
          ? checkTilesBuild(tileSelection, drill.answer?.sequence ?? [])
          : checkTilesSelect(tileSelection, drill.tiles ?? []);
      setChecked(true);
      setResult(r);
      if (!r) {
        setWrongAttempts((n) => n + 1);
        setShaking(true);
      }
      return;
    }
    // Format gate, ahead of grading: unparseable input for numeric/vector/
    // matrix is a format event, not a knowledge event — "a=6" or a stray
    // letter must never fall into `checkAnswer` and come back "wrong". No
    // attempt is logged and the drill stays unanswered; the message clears
    // itself the moment the learner edits the input again.
    if (!inputParses(drill.answer_type, input)) {
      const key = drill.answer_type as "numeric" | "vector" | "matrix";
      setFormatError(FORMAT_ERROR_MESSAGE[key] ?? null);
      return;
    }
    const userValue = drill.answer_type === "choice" ? selectedChoice ?? "" : input;
    const r = checkAnswer(drill.answer_type, userValue, drill.answer, drill.choices);
    setChecked(true);
    setResult(r);
    if (r === false) {
      setWrongAttempts((n) => n + 1);
      setShaking(true);
    }
  }

  // Workspace → answer input. RAW line text, never LaTeX — the learner types
  // in the grammar answers.ts already parses (§ the Arbejdsrum charter's
  // round-trip contract); the LaTeX exists only for the eye.
  function copyToAnswer(line: string) {
    if (result === true) return; // already solved; input is disabled
    setInput(line);
    setFormatError(null);
    setSheetOpen(false);
  }

  const difficulty = Math.min(Math.max(drill.difficulty ?? 1, 1), 3);
  const canCheck =
    drill.answer_type === "choice"
      ? selectedChoice !== null
      : drill.answer_type === "tiles"
        ? tileSelection.length > 0
        : input.trim().length > 0;

  // D2 — the answer block and its feedback banners, lifted verbatim into
  // consts so the desktop workspace pane can carry them as its footer
  // (charter: the pane "keeps the answer input at its bottom") while every
  // other breakpoint renders them in the card exactly as before. Known,
  // accepted wart: crossing the 1024px boundary mid-drill remounts the input
  // and drops focus (state is preserved).
  const answerBlock = (
    /* Answer surfaces stay hand-sized: a text field or an MCQ option
       stretched to a 46rem measure reads as a form, not a question. */
    <div className={`mt-3 md:mt-6 ${ANSWER_COL} ${shaking ? "animate-[learn-shake_.34s]" : ""}`}>
      {drill.answer_type === "numeric" && (
        <input
          inputMode="decimal"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setFormatError(null);
          }}
          placeholder="fx 6 eller 2/3"
          disabled={result === true}
          className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
        />
      )}
      {drill.answer_type === "vector" && (
        <>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFormatError(null);
            }}
            placeholder="fx 1, -2, 3"
            disabled={result === true}
            className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
          />
          {input.trim() ? (
            <p className="mt-1 text-[11px] text-[#6E6E78]/80">
              ⟨{input.trim()}⟩ · {input.split(/[,\s]+/).filter(Boolean).length} entries
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#6E6E78]/60">
              Skriv komponenterne adskilt med komma, fx 1, -2, 3
            </p>
          )}
        </>
      )}
      {drill.answer_type === "matrix" && (
        <>
          <textarea
            rows={3}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFormatError(null);
            }}
            placeholder="fx 1 2; 3 4"
            disabled={result === true}
            className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
          />
          {input.trim() ? (
            <p className="mt-1 text-[11px] text-[#6E6E78]/80">
              {input.split(/[;\n]+/).filter((r) => r.trim()).length} ×{" "}
              {input.split(/[;\n]+/)[0]?.trim().split(/[,\s]+/).filter(Boolean).length ?? 0}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#6E6E78]/60">
              Adskil rækker med semikolon, fx 1 2; 3 4
            </p>
          )}
        </>
      )}
      {drill.answer_type === "choice" && drill.choices && (
        <div className={drill.choices.length === 2 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
          {drill.choices.map((choice) => {
            const isSelected = selectedChoice === choice;
            let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
            if (checked) {
              const isCorrectChoice = checkAnswer("choice", choice, drill.answer, drill.choices) === true;
              if (isCorrectChoice) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
              else if (isSelected) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
              else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
            } else if (isSelected) {
              stateClass = "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
            }
            return (
              <button
                key={choice}
                type="button"
                disabled={result === true}
                onClick={() => setSelectedChoice(choice)}
                className={`min-h-[44px] w-full rounded-xl border px-3 py-3 text-left text-[14px] transition-colors ${stateClass}`}
              >
                <Markdown className="inline">{choice}</Markdown>
              </button>
            );
          })}
        </div>
      )}
      {drill.answer_type === "text" && (
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Skriv dit svar (selv-bedømt)…"
          className="w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-[16px] text-[#1A1A24] outline-none transition-shadow placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
        />
      )}
      {drill.answer_type === "tiles" && (
        <TileDrill
          tiles={drill.tiles ?? []}
          mode={drill.mode ?? "select"}
          answerSequence={drill.answer?.sequence}
          selection={tileSelection}
          onSelectionChange={setTileSelection}
          checked={checked}
          disabled={result === true}
        />
      )}
      {ws && layout === "phone" && (
        <div className="mt-2 flex justify-end">
          <WorkspaceToggle onClick={() => setSheetOpen(true)} count={scratchLineCount(wsKey)} />
        </div>
      )}
    </div>
  );

  const feedbackBlock = (
    <>
      {!isText && checked && result !== null && (
        <div
          className={`mt-3 flex animate-[learn-step-in_.18s_ease-out] items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] md:mt-4 md:max-w-[34rem] ${
            result ? FEEDBACK.correct : FEEDBACK.wrong
          }`}
        >
          <span className="text-[15px]">{result ? "✓" : "✕"}</span>
          <span>{result ? "Correct" : "Not quite"}</span>
        </div>
      )}

      {/* Format event, not a knowledge event (answers.ts `inputParses`) —
          neutral tone, never the red `FEEDBACK.wrong` treatment above.
          Mutually exclusive with it: this path returns out of `runCheck`
          before `checked`/`result` are ever set. */}
      {!isText && formatError && (
        <div
          className={`mt-3 flex animate-[learn-step-in_.18s_ease-out] items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] md:mt-4 md:max-w-[34rem] ${FEEDBACK.format}`}
        >
          <span className="text-[15px]">⚠</span>
          <span>{formatError}</span>
        </div>
      )}
    </>
  );

  return (
    <>
      <main className={`${MAIN_SHELL} pb-48`}>
        <div className={ws && layout === "desktop" ? WS_SPLIT_ROW : READING_COL}>
          <div className={ws && layout === "desktop" ? WS_SPLIT_MAIN : "contents"}>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[#6E6E78]">
          <span>{indexLabel}</span>
        </div>

        <div
          key={drill.id}
          className={`relative mt-2 animate-[learn-step-in_.18s_ease-out] overflow-hidden ${CARD} p-3 md:mt-3 md:p-8`}
        >
          <div className={`absolute inset-x-0 top-0 h-[2px] ${topBarClass}`} />

          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
              {ARCHETYPE_LABEL[archetype]}
            </span>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${LENS[drill.lens].chip}`}>
                <span className={`h-1 w-1 rounded-full ${LENS[drill.lens].dot}`} />
                {LENS[drill.lens].label}
              </span>
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${i < difficulty ? "bg-[#1A1A24]/55" : "bg-black/15"}`}
                  />
                ))}
              </span>
            </div>
          </div>

          <Markdown className="mt-2 text-[15px] leading-relaxed text-[#1A1A24]/85 md:mt-4 md:text-[16.5px]">
            {drill.prompt_md}
          </Markdown>

          {/* Answer + feedback live in `answerBlock`/`feedbackBlock` above —
              on desktop with the workspace on they relocate to the pane's
              footer (charter: answer at the bottom of the pane); everywhere
              else they render here exactly as before. */}
          {relocateAnswer && layout === "desktop" && ws ? null : (
            <>
              {answerBlock}
              {feedbackBlock}
            </>
          )}

          {hintsShown > 0 &&
            hints.slice(0, hintsShown).map((hint, i) => (
              <div
                key={i}
                className={`mt-2 animate-[learn-step-in_.2s_ease-out] rounded-r-lg py-2 pl-3 pr-2 text-[13px] text-[#1A1A24]/70 md:mt-3 md:py-3.5 md:pl-6 md:pr-5 md:text-[14.5px] ${LENS[drill.lens].edge} ${LENS[drill.lens].tint}`}
              >
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Hint {i + 1}</span>
                <Markdown className="text-[13px] leading-relaxed text-[#1A1A24]/70 md:text-[14.5px]">{hint}</Markdown>
              </div>
            ))}

          {showSolution && drill.solution_md && (
            <div className="relative mt-3 overflow-hidden rounded-xl border border-black/[0.06] bg-white p-3 pl-4 md:mt-6 md:rounded-2xl md:p-7 md:pl-9">
              <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-indigo-500 to-fuchsia-600" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">SOLUTION</p>
              <Markdown className="mt-1.5 text-[14px] leading-relaxed text-[#1A1A24]/80 md:mt-3 md:text-[16px]">
                {drill.solution_md}
              </Markdown>
            </div>
          )}
        </div>
        {ws && layout === "tablet" && (
          <Workspace key={wsKey} itemId={wsKey} onCopyToAnswer={copyToAnswer} variant="inline" />
        )}
          </div>
          {ws && layout === "desktop" && (
            <aside className={WS_PANE}>
              <Workspace
                key={wsKey}
                itemId={wsKey}
                onCopyToAnswer={copyToAnswer}
                variant="pane"
                footer={
                  relocateAnswer ? (
                    <>
                      {answerBlock}
                      {feedbackBlock}
                    </>
                  ) : null
                }
              />
            </aside>
          )}
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {!gradeVisible && (
            <div className="flex items-center gap-3 text-[12px]">
              {hintsShown < hints.length && (
                <button
                  type="button"
                  onClick={() => setHintsShown((n) => n + 1)}
                  className="min-h-[32px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
                >
                  Hint ({hintsShown + 1}/{hints.length})
                </button>
              )}
              {!isText && drill.solution_md && (
                <button
                  type="button"
                  onClick={() => setShowSolution(true)}
                  className={`ml-auto min-h-[32px] rounded-lg px-2.5 ${
                    wrongAttempts >= 2
                      ? "bg-black/[0.05] py-1.5 text-[12px] text-[#1A1A24]/70 active:bg-black/[0.08]"
                      : "text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
                  }`}
                >
                  Show solution
                </button>
              )}
            </div>
          )}

          {gradeVisible ? (
            <div className="flex gap-1.5">
              {GRADE_LABEL.map((label, g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onGraded(g as Grade)}
                  className={`flex-1 rounded-xl py-3 text-[12px] font-medium transition-transform active:scale-[0.97] ${GRADE_CLASS[g]}`}
                >
                  <span className={`block text-[10px] uppercase tracking-wide ${GRADE_NUM_CLASS[g]}`}>{g}</span>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={runCheck}
              disabled={!canCheck}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
            >
              {isText ? "Show solution" : "Check"}
            </button>
          )}
        </div>
      </footer>

      {ws && layout === "phone" && sheetOpen && (
        <Workspace
          key={wsKey}
          itemId={wsKey}
          onCopyToAnswer={copyToAnswer}
          variant="sheet"
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}
