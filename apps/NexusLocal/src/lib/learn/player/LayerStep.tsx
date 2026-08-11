/**
 * One layer of the interleaved unit flow (LEARN_PLAN.md "Layered unit flow",
 * DESIGN.md §9): **theory chunk → worked example → that layer's drills**.
 *
 * Replaces the old `TheoryStep` + `PracticeStep` pair. Being handed the whole
 * unit's theory at once was the thing that felt overwhelming, so a layer only
 * ever shows the theory boxes its own practice group needs
 * (`layers.deriveLayers`), and the drills follow immediately.
 *
 * Owns only its own cursor (phase / demo / drill index). Grading, the global
 * solved set and step navigation all live in `Player.tsx` — this component
 * calls `onGrade` and `onAdvance`.
 *
 * Not a hard gate: the "Continue" affordance is live whether or not the
 * layer's drills are solved. The test's `unlock_ratio` is the real gate, and
 * it counts across all of the unit's drills.
 */

import { useState } from "react";
import type { Drill, Grade, PracticeGroup, UnitContent, UnitLayer } from "../types";
import { useCourse } from "../CourseContext";
import { DrillCard } from "./DrillCard";
import { MasterDemoView } from "./MasterDemo";
import { TheoryCard, UnitOpening } from "./TheoryCards";
import { CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, READING_COL, detectSourceLens } from "./tokens";

type Phase = "theory" | "demo" | "drill" | "done";

/** First drill this user still owes, so re-entering a layer resumes forward. */
function firstUnsolved(drills: Drill[], solved: Set<string>): number {
  const i = drills.findIndex((d) => !solved.has(d.id));
  return i === -1 ? 0 : i;
}

export function LayerStep({
  content,
  layer,
  layerCount,
  showUnitOpening,
  solvedDrillIds,
  advanceLabel,
  advanceDisabled,
  advanceHint,
  onGrade,
  onAdvance,
}: {
  content: UnitContent;
  layer: UnitLayer;
  layerCount: number;
  /** Layer 1 carries the unit's title / intro / lens note above its theory. */
  showUnitOpening: boolean;
  solvedDrillIds: Set<string>;
  /** What the next step is, phrased for the dock: "Layer 3 →", "Test →", … */
  advanceLabel: string;
  /** Only ever true for "the next step is the test and it is still locked". */
  advanceDisabled?: boolean;
  advanceHint?: string;
  onGrade: (drill: Drill, group: PracticeGroup, grade: Grade) => void;
  onAdvance: () => void;
}) {
  const { course } = useCourse();
  const drills = layer.drills;
  const demo = layer.group?.master_demo;
  const hasDemo = !!demo && demo.steps.length > 0;
  const hasTheory = layer.theory.length > 0 || showUnitOpening;

  const [phase, setPhase] = useState<Phase>(() =>
    hasTheory ? "theory" : hasDemo ? "demo" : drills.length > 0 ? "drill" : "done"
  );
  const [drillIdx, setDrillIdx] = useState(() => firstUnsolved(drills, solvedDrillIds));

  const solvedHere = drills.filter((d) => solvedDrillIds.has(d.id)).length;
  const eyebrow = `Layer ${layer.index + 1} / ${layerCount}`;
  // A theory-only layer's primary button *is* the advance button — there is
  // no example and no drill to move on to inside the layer.
  const isDeadEnd = drills.length === 0 && !hasDemo;

  function startDrills() {
    if (drills.length === 0) {
      setPhase("done");
      return;
    }
    setDrillIdx(firstUnsolved(drills, solvedDrillIds));
    setPhase("drill");
  }

  function afterTheory() {
    if (hasDemo) setPhase("demo");
    else startDrills();
  }

  function handleGraded(drill: Drill, grade: Grade) {
    if (layer.group) onGrade(drill, layer.group, grade);
    if (drillIdx + 1 < drills.length) setDrillIdx((n) => n + 1);
    else setPhase("done");
  }

  // --- theory --------------------------------------------------------------
  if (phase === "theory") {
    return (
      <>
        <main className={`${MAIN_SHELL} pb-40`}>
          <div className={`${READING_COL} flex flex-col gap-3 md:gap-8`}>
            {showUnitOpening && <UnitOpening content={content} />}
            {layer.theory.length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
                {eyebrow}
              </p>
            )}
            {layer.theory.map((box) => (
              <TheoryCard key={box.concept_id + box.title} box={box} />
            ))}
          </div>
        </main>

        <footer className={DOCK_SHELL}>
          <div className={DOCK_STACK}>
            <p className="text-center text-[10px] text-[#6E6E78]/60">
              {isDeadEnd && advanceHint
                ? advanceHint
                : `${layer.theory.length} ${layer.theory.length === 1 ? "box" : "boxes"} · ${drills.length} ${
                    drills.length === 1 ? "drill" : "drills"
                  } in this layer`}
            </p>
            <button
              type="button"
              onClick={isDeadEnd ? onAdvance : afterTheory}
              disabled={isDeadEnd && advanceDisabled}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
            >
              {hasDemo ? "Example →" : drills.length > 0 ? "Practice →" : advanceLabel}
            </button>
          </div>
        </footer>
      </>
    );
  }

  // --- worked example ------------------------------------------------------
  if (phase === "demo" && demo) {
    return (
      <MasterDemoView
        demo={demo}
        eyebrow={`${eyebrow} · Example`}
        onSkip={startDrills}
        skipLabel={drills.length > 0 ? "Skip to drills" : "Skip"}
        onDone={startDrills}
        doneLabel={drills.length > 0 ? "Start drills →" : advanceLabel}
      />
    );
  }

  // --- drills --------------------------------------------------------------
  if (phase === "drill" && drills.length > 0) {
    const drill = drills[Math.min(drillIdx, drills.length - 1)];
    const archetype = layer.group?.archetype ?? "computational";
    const translateFrom = archetype === "translate" ? detectSourceLens(drill.prompt_md, course) : null;
    return (
      <DrillCard
        key={drill.id}
        drill={drill}
        archetype={archetype}
        indexLabel={`Layer ${layer.index + 1} · Drill ${drillIdx + 1} / ${drills.length}`}
        translateFrom={translateFrom}
        onGraded={(grade) => handleGraded(drill, grade)}
      />
    );
  }

  // --- layer complete ------------------------------------------------------
  return (
    <>
      <main className={`${MAIN_SHELL} pb-40`}>
        <div className={`${READING_COL} md:max-w-[32rem]`}>
          <div className={`${CARD} p-4 text-center md:p-8`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
              {eyebrow}
            </p>
            <p className="mt-2 text-[15px] font-medium text-[#1A1A24]/85 md:text-[17px]">
              {drills.length > 0
                ? `Layer complete — ${solvedHere}/${drills.length} drills solved.`
                : "Layer complete."}
            </p>
            {advanceHint ? (
              <p className="mt-1 text-[12px] text-[#6E6E78] md:mt-2 md:text-[13px]">{advanceHint}</p>
            ) : (
              drills.length > 0 &&
              solvedHere < drills.length && (
                <p className="mt-1 text-[12px] text-[#6E6E78] md:mt-2 md:text-[13px]">
                  Unsolved drills still count against the test unlock — you can come back to them.
                </p>
              )
            )}
          </div>
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {(layer.theory.length > 0 || hasDemo || drills.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setDrillIdx(0);
                setPhase(hasTheory ? "theory" : hasDemo ? "demo" : "drill");
              }}
              className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
            >
              Go through this layer again
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
