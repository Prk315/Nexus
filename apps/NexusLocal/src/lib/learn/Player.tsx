/**
 * The fullscreen unit player (`LEARN_PLAN.md` Phase 2, `DESIGN.md` §3).
 * Theory → Practice → Test stepper; drill grading runs through
 * `answers.checkAnswer` for correctness and `memory.applyGrade` +
 * `api.upsertMemory` / `api.logAttempt` for the Beta/heat update, lens-tagged.
 * Passing the test (≥75%) graduates the unit: `api.setUnitProgress` to
 * "mastered" plus heat re-seeding (`memory.seedGraduationHeat`) for every
 * concept the unit covers, then the graduation ceremony (`player/Graduation`).
 *
 * Public contract is exactly `{ unitId: number, onClose: () => void }` per
 * LEARN_PLAN.md's file-ownership table — no other props, no default export.
 *
 * DESIGN.md §5 asks for the shared motion + KaTeX phone-width `<style>` to be
 * injected once, reachable even when `Player` isn't mounted (via
 * `Markdown.tsx`). `Markdown.tsx` as built doesn't inject it and is outside
 * this slice's ownership, so this component injects its own complete copy
 * (`player/tokens.ts`'s `PLAYER_STYLE`) at the top of the overlay — see that
 * file's header comment for the full explanation.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. The overlay
 * background flips from `#0a0a0f` to `#F6F5F1`; every `white/NN` opacity
 * step below is replaced with the ink/muted tokens from the same table.
 */

import { useEffect, useMemo, useState } from "react";
import type { Drill, Grade, Lens, LrMemoryState, LrUnitContentRow, PracticeGroup } from "./types";
import { fetchMemoryStates, fetchUnitContent, logAttempt, setUnitProgress, upsertMemory } from "./api";
import { applyGrade, defaultMemoryState, seedGraduationHeat } from "./memory";
import { TheoryStep } from "./player/TheoryStep";
import { PracticeStep } from "./player/PracticeStep";
import { TestStep } from "./player/TestStep";
import { Graduation } from "./player/Graduation";
import { FEEDBACK, PLAYER_STYLE } from "./player/tokens";

type Step = "theory" | "practice" | "test";
const STEP_ORDER: Step[] = ["theory", "practice", "test"];
const STEP_LABEL: Record<Step, string> = { theory: "Theory", practice: "Practice", test: "Test" };

export function Player({ unitId, onClose }: { unitId: number; onClose: () => void }) {
  const [row, setRow] = useState<LrUnitContentRow | null | undefined>(undefined); // undefined = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("theory");
  const [solvedDrillIds, setSolvedDrillIds] = useState<Set<string>>(new Set());
  const [memoryCache, setMemoryCache] = useState<Record<string, LrMemoryState>>({});
  const [graduation, setGraduation] = useState<{ score: number; total: number } | null>(null);

  const content = row?.content ?? null;

  const allConceptIds = useMemo(() => {
    if (!content) return [];
    const ids = new Set<string>();
    content.theory.forEach((t) => ids.add(t.concept_id));
    content.practice.forEach((g) => g.concept_ids.forEach((id) => ids.add(id)));
    return Array.from(ids);
  }, [content]);

  useEffect(() => {
    let alive = true;
    fetchUnitContent(unitId)
      .then((r) => {
        if (!alive) return;
        setRow(r);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(String(e));
        setRow(null);
      });
    return () => {
      alive = false;
    };
  }, [unitId]);

  useEffect(() => {
    if (allConceptIds.length === 0) return;
    let alive = true;
    fetchMemoryStates(allConceptIds)
      .then((states) => {
        if (alive) setMemoryCache(states);
      })
      .catch((e) => console.error("[learn] fetchMemoryStates failed", e));
    return () => {
      alive = false;
    };
    // Only re-run when the set of concepts changes (content load), not on
    // every memoryCache write below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConceptIds.join(",")]);

  const totalDrills = content?.practice.reduce((n, g) => n + g.drills.length, 0) ?? 0;
  const solvedCount = content
    ? content.practice.reduce((n, g) => n + g.drills.filter((d) => solvedDrillIds.has(d.id)).length, 0)
    : 0;
  const unlockRatio = content?.test.unlock_ratio ?? 1;
  const testUnlocked = totalDrills > 0 && solvedCount / totalDrills >= unlockRatio;

  function handleGrade(drill: Drill, group: PracticeGroup, grade: Grade) {
    const nowLens: Lens = drill.lens;
    setMemoryCache((prev) => {
      const next = { ...prev };
      for (const conceptId of group.concept_ids) {
        const existing = prev[conceptId] ?? defaultMemoryState("default", conceptId);
        const updated = applyGrade(existing, grade, nowLens);
        next[conceptId] = updated;
        upsertMemory(updated).catch((e) => console.error("[learn] upsertMemory failed", e));
      }
      return next;
    });
    logAttempt({ itemRef: drill.id, lens: drill.lens, grade }).catch((e) =>
      console.error("[learn] logAttempt failed", e)
    );
    setSolvedDrillIds((prev) => {
      const next = new Set(prev);
      next.add(drill.id);
      return next;
    });
  }

  async function handleTestPass(score: number, total: number) {
    try {
      await setUnitProgress(unitId, "mastered", new Date().toISOString());
      await Promise.all(
        allConceptIds.map(async (conceptId) => {
          const existing = memoryCache[conceptId] ?? defaultMemoryState("default", conceptId);
          const seeded = seedGraduationHeat(existing);
          await upsertMemory(seeded);
        })
      );
    } catch (e) {
      console.error("[learn] graduation persistence failed", e);
    }
    setGraduation({ score, total });
  }

  function handleTestFail() {
    setStep("practice");
  }

  const exercisedLenses = useMemo(() => {
    const set = new Set<Lens>();
    if (content) {
      content.theory.forEach((t) => t.perspective && set.add(t.perspective));
      content.practice.forEach((g) => g.drills.forEach((d) => set.add(d.lens)));
      content.test.questions.forEach((q) => set.add(q.lens));
    }
    return set;
  }, [content]);

  function stepReachable(s: Step): boolean {
    if (s === "test") return testUnlocked;
    return true;
  }

  function stepFillPct(s: Step): number {
    const idx = STEP_ORDER.indexOf(s);
    const currentIdx = STEP_ORDER.indexOf(step);
    if (idx < currentIdx) return 100;
    if (idx > currentIdx) return 0;
    if (s === "theory") return 60;
    if (s === "practice") return totalDrills > 0 ? Math.round((solvedCount / totalDrills) * 100) : 0;
    return 50;
  }

  const isDraft = row?.status === "draft";
  const title = content?.title || content?.unit_code || `Unit ${unitId}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
            aria-label="Close"
          >
            ✕
          </button>
          <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">{title}</span>
          {isDraft && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.draft}`}
            >
              KLADDE
            </span>
          )}
        </div>

        {content && !graduation && (
          <div className="mt-2 flex gap-1.5">
            {STEP_ORDER.map((s) => {
              const reachable = stepReachable(s);
              const active = s === step;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!reachable}
                  onClick={() => setStep(s)}
                  className="group flex min-h-[44px] flex-1 flex-col justify-center text-left"
                >
                  <span
                    className={`block h-[3px] w-full overflow-hidden rounded-full ${
                      s === "test" && !reachable ? "bg-black/[0.04] ring-1 ring-dashed ring-black/10" : "bg-black/[0.07]"
                    }`}
                  >
                    <span
                      className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
                      style={{ width: `${stepFillPct(s)}%` }}
                    />
                  </span>
                  <span
                    className={`mt-1 block text-[10px] tracking-wide ${
                      active ? "text-[#1A1A24]/85" : reachable ? "text-[#6E6E78]" : "text-[#6E6E78]/40"
                    }`}
                  >
                    {STEP_LABEL[s]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {row === undefined && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {row === null && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[13px] text-[#1A1A24]/70">
            {loadError ? "Could not load this unit." : "No content yet for this unit."}
          </p>
          {loadError && <p className="text-[11px] text-[#6E6E78]/70">{loadError}</p>}
        </main>
      )}

      {content && graduation && (
        <Graduation
          title={title}
          drillsTotal={totalDrills}
          testScore={graduation.score}
          testTotal={graduation.total}
          estMinutes={content.est_minutes}
          exercisedLenses={exercisedLenses}
          conceptIds={allConceptIds}
          onContinue={onClose}
        />
      )}

      {content && !graduation && step === "theory" && (
        <TheoryStep content={content} onContinue={() => setStep("practice")} />
      )}

      {content && !graduation && step === "practice" && (
        <PracticeStep
          content={content}
          solvedDrillIds={solvedDrillIds}
          unlockRatio={unlockRatio}
          onGrade={handleGrade}
          onGoToTest={() => setStep("test")}
        />
      )}

      {content && !graduation && step === "test" && (
        <TestStep
          test={content.test}
          unlocked={testUnlocked}
          solvedCount={solvedCount}
          totalDrills={totalDrills}
          onPass={handleTestPass}
          onFail={handleTestFail}
        />
      )}
    </div>
  );
}
