/**
 * Practice step (`Player.tsx` §3.4–3.5): per group, a progressively-revealed
 * master demo, then that group's drills one at a time, flattened into a
 * single "Drill n / total" sequence across all groups.
 *
 * Owns only its own cursor (which group/phase/drill/demo-step it's on).
 * Grading, memory updates and persistence live in `Player.tsx` — this
 * component just calls `onGrade` and advances.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7.
 */

import { useEffect, useRef, useState } from "react";
import type { Drill, Grade, PracticeGroup, UnitContent } from "../types";
import { Markdown } from "../Markdown";
import { DrillCard } from "./DrillCard";
import { detectSourceLens } from "./tokens";

type Phase = "demo" | "drill" | "complete";

function initialPhase(group: PracticeGroup | undefined): Phase {
  if (!group) return "complete";
  return group.master_demo && group.master_demo.steps.length > 0 ? "demo" : "drill";
}

export function PracticeStep({
  content,
  solvedDrillIds,
  unlockRatio,
  onGrade,
  onGoToTest,
}: {
  content: UnitContent;
  solvedDrillIds: Set<string>;
  unlockRatio: number;
  onGrade: (drill: Drill, group: PracticeGroup, grade: Grade) => void;
  onGoToTest: () => void;
}) {
  const groups = content.practice;
  const [groupIdx, setGroupIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(() => initialPhase(groups[0]));
  const [demoRevealed, setDemoRevealed] = useState(1);
  const [drillIdx, setDrillIdx] = useState(0);
  const lastStepRef = useRef<HTMLLIElement | null>(null);

  const totalDrills = groups.reduce((n, g) => n + g.drills.length, 0);
  const solvedCount = groups.reduce(
    (n, g) => n + g.drills.filter((d) => solvedDrillIds.has(d.id)).length,
    0
  );
  const unlocked = totalDrills > 0 && solvedCount / totalDrills >= unlockRatio;

  useEffect(() => {
    if (phase === "demo" && lastStepRef.current) {
      lastStepRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [phase, demoRevealed]);

  function goToGroup(nextIdx: number) {
    setGroupIdx(nextIdx);
    setDemoRevealed(1);
    setDrillIdx(0);
    setPhase(initialPhase(groups[nextIdx]));
  }

  function handleGraded(drill: Drill, group: PracticeGroup, grade: Grade) {
    onGrade(drill, group, grade);
    const group_ = groups[groupIdx];
    if (drillIdx + 1 < group_.drills.length) {
      setDrillIdx((n) => n + 1);
    } else if (groupIdx + 1 < groups.length) {
      goToGroup(groupIdx + 1);
    } else {
      setPhase("complete");
    }
  }

  if (groups.length === 0 || phase === "complete") {
    const remaining = Math.max(0, Math.ceil(unlockRatio * totalDrills) - solvedCount);
    return (
      <>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40">
          <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
            <p className="text-[15px] font-medium text-[#1A1A24]/85">
              Practice complete — {solvedCount}/{totalDrills} drills solved.
            </p>
            <p className="mt-1 text-[12px] text-[#6E6E78]">
              {unlocked
                ? "Test unlocked."
                : `Solve ${remaining} more drill${remaining === 1 ? "" : "s"} to unlock the test.`}
            </p>
          </div>
        </main>
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex flex-col gap-2">
            {groups.length > 0 && (
              <button
                type="button"
                onClick={() => goToGroup(0)}
                className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
              >
                Review drills again
              </button>
            )}
            <button
              type="button"
              onClick={onGoToTest}
              disabled={!unlocked}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
            >
              Take the test →
            </button>
          </div>
        </footer>
      </>
    );
  }

  const group = groups[groupIdx];

  if (phase === "demo" && group.master_demo) {
    const steps = group.master_demo.steps;
    const isLast = demoRevealed >= steps.length;
    return (
      <>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40">
          <div className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
            <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/80">
              {group.master_demo.prompt_md}
            </Markdown>
          </div>

          <ol className="relative mt-4 pl-1">
            <div className="pointer-events-none absolute left-[11px] top-2 bottom-2 w-px bg-black/[0.08]" />
            <div
              className="pointer-events-none absolute left-[11px] top-2 w-px rounded-full bg-gradient-to-b from-indigo-500 to-fuchsia-500 transition-[height] duration-500 ease-out"
              style={{ height: `${(demoRevealed / steps.length) * 100}%` }}
            />
            {steps.slice(0, demoRevealed).map((step, i) => {
              const isLatest = i === demoRevealed - 1;
              return (
                <li
                  key={i}
                  ref={isLatest ? lastStepRef : undefined}
                  className="relative animate-[learn-step-in_.2s_ease-out] pb-4 pl-8"
                >
                  <span
                    className={`absolute left-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[10px] ${
                      isLatest
                        ? "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white"
                        : "bg-black/[0.05] text-[#6E6E78] ring-1 ring-black/10"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <p className={`text-[14px] font-medium leading-snug ${isLatest ? "text-[#1A1A24]/90" : "text-[#1A1A24]/55"}`}>
                    {step.what}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#6E6E78]">{step.why}</p>
                  <div className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-[14px] text-[#1A1A24]/80 ring-1 ring-black/[0.06]">
                    <Markdown>{step.how}</Markdown>
                  </div>
                </li>
              );
            })}
          </ol>
        </main>
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setPhase("drill")}
              className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
            >
              Skip to drills
            </button>
            <button
              type="button"
              onClick={() => (isLast ? setPhase("drill") : setDemoRevealed((n) => n + 1))}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              {isLast ? "Start drills →" : `Next step (${demoRevealed + 1}/${steps.length})`}
            </button>
          </div>
        </footer>
      </>
    );
  }

  // phase === "drill"
  const drill = group.drills[drillIdx];
  const priorGroupsDrills = groups.slice(0, groupIdx).reduce((n, g) => n + g.drills.length, 0);
  const globalIndex = priorGroupsDrills + drillIdx + 1;
  const translateFrom = group.archetype === "translate" ? detectSourceLens(drill.prompt_md) : null;

  return (
    <DrillCard
      key={drill.id}
      drill={drill}
      archetype={group.archetype}
      indexLabel={`Drill ${globalIndex} / ${totalDrills}`}
      translateFrom={translateFrom}
      onGraded={(grade) => handleGraded(drill, group, grade)}
    />
  );
}
