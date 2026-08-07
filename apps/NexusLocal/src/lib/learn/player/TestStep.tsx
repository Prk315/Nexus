/**
 * Test step (`Player.tsx` §3.6): locked meter until `unlock_ratio` of drills
 * are solved, then one MCQ at a time with every option's `why_md` revealed
 * (correct and distractor alike) on answer, then a final score card gating
 * graduation at ≥75%.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. The score
 * gradient-clip text darkens from -400 to -600 shades (light-on-white is
 * invisible).
 */

import { useState } from "react";
import type { TestQuestion, TestSection } from "../types";
import { Markdown } from "../Markdown";
import { FEEDBACK, LENS } from "./tokens";

function QuestionCard({
  question,
  selected,
  onSelect,
}: {
  question: TestQuestion;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <div className="mb-2 flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${LENS[question.lens].chip}`}>
          <span className={`h-1 w-1 rounded-full ${LENS[question.lens].dot}`} />
          {LENS[question.lens].label}
        </span>
      </div>
      <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/85">{question.prompt_md}</Markdown>

      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((opt, i) => {
          const answered = selected !== null;
          const isChosen = selected === i;
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
                onClick={() => onSelect(i)}
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
                    <p
                      className={`px-3 pb-1 pt-1.5 text-[12px] leading-relaxed ${
                        opt.correct ? "text-emerald-700/80" : isChosen ? "text-red-700/80" : "text-[#6E6E78]/80"
                      }`}
                    >
                      {opt.why_md}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TestStep({
  test,
  unlocked,
  solvedCount,
  totalDrills,
  onPass,
  onFail,
}: {
  test: TestSection;
  unlocked: boolean;
  solvedCount: number;
  totalDrills: number;
  onPass: (score: number, total: number) => void;
  onFail: () => void;
}) {
  const [qIdx, setQIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, number>>({});

  if (!unlocked) {
    const pct = totalDrills > 0 ? Math.round((solvedCount / totalDrills) * 100) : 0;
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain px-4 pb-40 pt-3">
        <div className="w-full rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-4 text-center">
          <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Test locked</div>
          <div className="mt-2 font-mono text-2xl tabular-nums text-[#1A1A24]/80">
            {solvedCount} / {totalDrills}
          </div>
          <div className="mx-auto mt-2 h-[3px] w-40 overflow-hidden rounded-full bg-black/[0.08]">
            <span
              className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[#6E6E78]">Solve more drills to unlock the test.</p>
        </div>
      </main>
    );
  }

  const questions = test.questions;
  const total = questions.length;

  if (qIdx >= total) {
    const score = questions.reduce((n, q) => {
      const sel = selections[q.id];
      return n + (sel !== undefined && q.options[sel]?.correct ? 1 : 0);
    }, 0);
    const pass = total > 0 && score / total >= 0.75;
    return (
      <>
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain px-4 pb-40 pt-3 text-center">
          <div
            className="bg-clip-text font-mono text-4xl text-transparent"
            style={{ backgroundImage: "linear-gradient(to right, #4f46e5, #c026d3)" }}
          >
            {score} / {total}
          </div>
          {!pass && (
            <p className={`mt-4 rounded-xl px-3 py-2.5 text-[13px] ${FEEDBACK.wrong}`}>
              Not yet — {score}/{total}. Try again after another pass through the drills.
            </p>
          )}
        </main>
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto">
            <button
              type="button"
              onClick={() => (pass ? onPass(score, total) : onFail())}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              {pass ? "Continue →" : "Back to drills"}
            </button>
          </div>
        </footer>
      </>
    );
  }

  const question = questions[qIdx];
  const selected = selections[question.id] ?? null;

  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-[#6E6E78]">
          Question {qIdx + 1} / {total}
        </p>
        <QuestionCard
          question={question}
          selected={selected}
          onSelect={(i) => setSelections((s) => ({ ...s, [question.id]: i }))}
        />
      </main>
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={() => setQIdx((n) => n + 1)}
            disabled={selected === null}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
          >
            {qIdx + 1 === total ? "See results" : "Next question"}
          </button>
        </div>
      </footer>
    </>
  );
}
