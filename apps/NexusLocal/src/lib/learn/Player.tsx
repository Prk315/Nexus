/**
 * The fullscreen unit player (`LEARN_PLAN.md` Phase 2, `DESIGN.md` §3 + §9).
 *
 * v4 (2026-08-10) — **interleaved layers**. The unit is no longer three blocked
 * steps (all theory → all practice → test); being handed a whole unit's theory
 * in one scroll was the thing that felt overwhelming. The step sequence is now
 * derived per unit by `layers.deriveLayers`:
 *
 *     layer 1 (theory chunk → example → drills)
 *     layer 2 …
 *     rapid round  (the archetype:"tiles" groups, whole-unit mix — if any)
 *     test         → graduate iff ≥75 %
 *
 * What did NOT change: grading (`answers.checkAnswer` for correctness,
 * `memory.applyGrade` + `api.upsertMemory` / `api.logAttempt` for the
 * Beta/heat update, lens-tagged), the test's `unlock_ratio` gate — still
 * counted across ALL of the unit's drills, not per layer — graduation
 * (`api.setUnitProgress("mastered")` + `memory.seedGraduationHeat`), the
 * KLADDE draft badge, and the ceremony in `player/Graduation`.
 *
 * Navigation is deliberately soft: any already-visited step is tappable in the
 * stepper, and the *next* one always is too, so a layer's drills never trap
 * you. The one real gate is the test, which stays non-tappable until
 * `unlock_ratio` of the unit's drills are solved (DESIGN.md §3.2).
 *
 * Continuity: the solved set is seeded from `lr_attempt_log`
 * (`api.fetchSolvedDrillIds`), so re-entering a unit resumes at the first
 * layer that still owes drills instead of restarting at layer 1.
 *
 * Public contract is exactly `{ unitId: number, onClose: () => void }` per
 * LEARN_PLAN.md's file-ownership table — no other props, no default export.
 *
 * DESIGN.md §5 asks for the shared motion + KaTeX phone-width `<style>` to be
 * injected once, reachable even when `Player` isn't mounted (via
 * `Markdown.tsx`). `Markdown.tsx` as built doesn't inject it and is outside
 * this slice's ownership, so this component injects its own complete copy
 * (`player/tokens.tsx`'s `PLAYER_STYLE`) at the top of the overlay.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7.
 * v3 (2026-08-10): desktop reading layout — DESIGN.md §8.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Drill,
  Grade,
  Lens,
  LrMemoryState,
  LrUnitContentRow,
  PracticeGroup,
  UnitFlow,
} from "./types";
import {
  fetchMemoryStates,
  fetchSolvedDrillIds,
  fetchUnitContent,
  logAttempt,
  setUnitProgress,
  upsertMemory,
} from "./api";
import { deriveLayers } from "./layers";
import { applyGrade, defaultMemoryState, seedGraduationHeat } from "./memory";
import { LayerStep } from "./player/LayerStep";
import { FinalRound } from "./player/FinalRound";
import { TestStep } from "./player/TestStep";
import { Graduation } from "./player/Graduation";
import { Stepper, type StepSegment } from "./player/Stepper";
import { FEEDBACK, PLAYER_STYLE, READING_COL } from "./player/tokens";

type Step =
  | { kind: "layer"; layerIdx: number }
  | { kind: "final" }
  | { kind: "test" };

/** [layer 1 … layer N, rapid round (if any), test]. */
function buildSteps(flow: UnitFlow): Step[] {
  const steps: Step[] = flow.layers.map((_, layerIdx) => ({ kind: "layer" as const, layerIdx }));
  if (flow.finalDrills.length > 0) steps.push({ kind: "final" });
  steps.push({ kind: "test" });
  return steps;
}

/** First step that still owes work: earliest layer with an unsolved drill. */
function resumeIndex(steps: Step[], flow: UnitFlow, solved: Set<string>): number {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "layer") {
      if (flow.layers[s.layerIdx].drills.some((d) => !solved.has(d.id))) return i;
    } else if (s.kind === "final") {
      if (flow.finalDrills.some((d) => !solved.has(d.id))) return i;
    }
  }
  // Everything solved — land on the test.
  return Math.max(0, steps.length - 1);
}

function stepLabel(step: Step): string {
  if (step.kind === "layer") return `Layer ${step.layerIdx + 1}`;
  if (step.kind === "final") return "Rapid round";
  return "Test";
}

export function Player({ unitId, onClose }: { unitId: number; onClose: () => void }) {
  const [row, setRow] = useState<LrUnitContentRow | null | undefined>(undefined); // undefined = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [solvedDrillIds, setSolvedDrillIds] = useState<Set<string>>(new Set());
  const [memoryCache, setMemoryCache] = useState<Record<string, LrMemoryState>>({});
  const [graduation, setGraduation] = useState<{ score: number; total: number } | null>(null);
  const resumedRef = useRef(false);

  const content = row?.content ?? null;

  const flow = useMemo(() => (content ? deriveLayers(content) : null), [content]);
  const steps = useMemo(() => (flow ? buildSteps(flow) : []), [flow]);

  const allConceptIds = useMemo(() => {
    if (!content) return [];
    const ids = new Set<string>();
    content.theory.forEach((t) => ids.add(t.concept_id));
    content.practice.forEach((g) => g.concept_ids.forEach((id) => ids.add(id)));
    return Array.from(ids);
  }, [content]);

  const allDrillIds = useMemo(() => {
    if (!content) return [];
    return content.practice.flatMap((g) => g.drills.map((d) => d.id));
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

  // Continuity: recover which drills this user has already graded, then jump
  // to the first layer that still owes work. Runs once per mounted unit; a
  // failed lookup resolves as "nothing solved", which keeps the test gate shut
  // rather than opening it.
  useEffect(() => {
    if (!flow || steps.length === 0 || resumedRef.current) return;
    if (allDrillIds.length === 0) {
      resumedRef.current = true;
      return;
    }
    // No `alive` flag here on purpose: `resumedRef` already makes this
    // run-once, and under StrictMode's double-invoked effects an
    // `alive = false` cleanup would discard the only in-flight result while
    // the ref blocks the retry — i.e. resume would silently never happen in
    // dev. A late `setState` after unmount is a harmless no-op in React 18.
    resumedRef.current = true;
    fetchSolvedDrillIds(allDrillIds)
      .then((solved) => {
        if (solved.size === 0) return;
        setSolvedDrillIds((prev) => new Set([...prev, ...solved]));
        const idx = resumeIndex(steps, flow, solved);
        setStepIdx(idx);
        setMaxVisited((m) => Math.max(m, idx));
      })
      .catch((e) => console.error("[learn] fetchSolvedDrillIds failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, steps.length, allDrillIds.join(",")]);

  const totalDrills = flow?.totalDrills ?? 0;
  const solvedCount = allDrillIds.filter((id) => solvedDrillIds.has(id)).length;
  const unlockRatio = content?.test.unlock_ratio ?? 1;
  const testUnlocked = totalDrills > 0 && solvedCount / totalDrills >= unlockRatio;
  const remainingToUnlock = Math.max(0, Math.ceil(unlockRatio * totalDrills) - solvedCount);

  function goToStep(idx: number) {
    const clamped = Math.max(0, Math.min(idx, steps.length - 1));
    setStepIdx(clamped);
    setMaxVisited((m) => Math.max(m, clamped));
  }

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
    // Back to the earliest step that still owes drills, not blindly to step 0.
    if (flow) goToStep(resumeIndex(steps, flow, solvedDrillIds));
    else goToStep(0);
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

  const segments: StepSegment[] = useMemo(() => {
    if (!flow) return [];
    return steps.map((s, i): StepSegment => {
      if (s.kind === "test") {
        return {
          kind: "test",
          label: "Test",
          fillPct: graduation ? 100 : i === stepIdx ? 50 : 0,
          reachable: testUnlocked,
          locked: !testUnlocked,
        };
      }
      const drills = s.kind === "layer" ? flow.layers[s.layerIdx].drills : flow.finalDrills;
      const solved = drills.filter((d) => solvedDrillIds.has(d.id)).length;
      const fillPct =
        drills.length > 0
          ? Math.round((solved / drills.length) * 100)
          : i < stepIdx
            ? 100
            : i === stepIdx
              ? 60
              : 0;
      return {
        kind: s.kind,
        label: stepLabel(s),
        number: s.kind === "layer" ? s.layerIdx + 1 : undefined,
        fillPct,
        // Soft navigation: anything already visited, plus one step forward.
        reachable: i <= maxVisited + 1,
        solved: [solved, drills.length],
      };
    });
  }, [flow, steps, stepIdx, maxVisited, solvedDrillIds, testUnlocked, graduation]);

  const isDraft = row?.status === "draft";
  const title = content?.title || content?.unit_code || `Unit ${unitId}`;
  const step: Step | undefined = steps[stepIdx];
  const nextStep: Step | undefined = steps[stepIdx + 1];
  const nextIsLockedTest = nextStep?.kind === "test" && !testUnlocked;
  const advanceLabel = nextStep
    ? nextStep.kind === "layer"
      ? `Layer ${nextStep.layerIdx + 1} →`
      : nextStep.kind === "final"
        ? "Rapid round →"
        : "Take the test →"
    : "Take the test →";
  const advanceHint = nextIsLockedTest
    ? `Solve ${remainingToUnlock} more drill${remainingToUnlock === 1 ? "" : "s"} to unlock the test.`
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      {/* The header is columnar too — the chrome tracks the reading column so
          the whole overlay reads as one sheet of paper rather than a phone
          layout stretched across the window (DESIGN.md §8.1). */}
      <header className="shrink-0 border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8">
        <div className={READING_COL}>
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

          {content && !graduation && segments.length > 0 && (
            <Stepper segments={segments} activeIdx={stepIdx} onSelect={goToStep} />
          )}
        </div>
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

      {content && graduation && flow && (
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

      {content && flow && !graduation && step?.kind === "layer" && (
        <LayerStep
          key={`layer-${step.layerIdx}`}
          content={content}
          layer={flow.layers[step.layerIdx]}
          layerCount={flow.layers.length}
          showUnitOpening={step.layerIdx === 0}
          solvedDrillIds={solvedDrillIds}
          advanceLabel={advanceLabel}
          advanceDisabled={nextIsLockedTest}
          advanceHint={advanceHint}
          onGrade={handleGrade}
          onAdvance={() => goToStep(stepIdx + 1)}
        />
      )}

      {content && flow && !graduation && step?.kind === "final" && (
        <FinalRound
          key="final-round"
          groups={flow.finalRound}
          solvedDrillIds={solvedDrillIds}
          testUnlocked={testUnlocked}
          solvedCount={solvedCount}
          totalDrills={totalDrills}
          unlockRatio={unlockRatio}
          onGrade={handleGrade}
          onGoToTest={() => goToStep(stepIdx + 1)}
        />
      )}

      {content && !graduation && step?.kind === "test" && (
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
