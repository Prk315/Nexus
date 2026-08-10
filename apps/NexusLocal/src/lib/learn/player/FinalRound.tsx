/**
 * The rapid round — the closing beat of the layered flow (LEARN_PLAN.md
 * "Layered unit flow", DESIGN.md §9).
 *
 * Every `archetype: "tiles"` group in the unit, flattened into one brisk
 * tap-sequence over the *whole* unit rather than a per-layer slice. No theory
 * above it and no worked example (tiles groups may omit `master_demo` by
 * schema): the point is speed and whole-unit mixing after the layers have
 * taught each piece in isolation.
 *
 * Drill mechanics are `DrillCard`'s, unchanged — including grading, which
 * feeds the same global solved set that gates the test.
 */

import { useState } from "react";
import type { Drill, Grade, PracticeGroup } from "../types";
import { DrillCard } from "./DrillCard";
import { CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, READING_COL } from "./tokens";

/** Flattened `{drill, group}` pairs — grading credits the drill's own group. */
function flattenRound(groups: PracticeGroup[]): Array<{ drill: Drill; group: PracticeGroup }> {
  return groups.flatMap((group) => (group.drills ?? []).map((drill) => ({ drill, group })));
}

export function FinalRound({
  groups,
  solvedDrillIds,
  testUnlocked,
  solvedCount,
  totalDrills,
  unlockRatio,
  onGrade,
  onGoToTest,
}: {
  groups: PracticeGroup[];
  solvedDrillIds: Set<string>;
  testUnlocked: boolean;
  solvedCount: number;
  totalDrills: number;
  unlockRatio: number;
  onGrade: (drill: Drill, group: PracticeGroup, grade: Grade) => void;
  onGoToTest: () => void;
}) {
  const items = flattenRound(groups);
  const [idx, setIdx] = useState(() => {
    const i = items.findIndex((it) => !solvedDrillIds.has(it.drill.id));
    return i === -1 ? 0 : i;
  });
  const [done, setDone] = useState(items.length === 0);

  if (!done && items.length > 0) {
    const { drill, group } = items[Math.min(idx, items.length - 1)];
    return (
      <DrillCard
        key={drill.id}
        drill={drill}
        archetype={group.archetype}
        indexLabel={`Rapid round · ${idx + 1} / ${items.length}`}
        onGraded={(grade) => {
          onGrade(drill, group, grade);
          if (idx + 1 < items.length) setIdx((n) => n + 1);
          else setDone(true);
        }}
      />
    );
  }

  const solvedHere = items.filter((it) => solvedDrillIds.has(it.drill.id)).length;
  const remaining = Math.max(0, Math.ceil(unlockRatio * totalDrills) - solvedCount);

  return (
    <>
      <main className={`${MAIN_SHELL} pb-40`}>
        <div className={`${READING_COL} md:max-w-[32rem]`}>
          <div className={`${CARD} p-4 text-center md:p-8`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
              Rapid round — whole unit
            </p>
            <p className="mt-2 text-[15px] font-medium text-[#1A1A24]/85 md:text-[17px]">
              {items.length > 0 ? `${solvedHere}/${items.length} tap drills solved.` : "Nothing to tap here."}
            </p>
            <p className="mt-1 text-[12px] text-[#6E6E78] md:mt-2 md:text-[13px]">
              {testUnlocked
                ? `Test unlocked — ${solvedCount}/${totalDrills} drills solved across the unit.`
                : `Solve ${remaining} more drill${remaining === 1 ? "" : "s"} to unlock the test.`}
            </p>
          </div>
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIdx(0);
                setDone(false);
              }}
              className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
            >
              Run the round again
            </button>
          )}
          <button
            type="button"
            onClick={onGoToTest}
            disabled={!testUnlocked}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985] disabled:opacity-40"
          >
            Take the test →
          </button>
        </div>
      </footer>
    </>
  );
}
