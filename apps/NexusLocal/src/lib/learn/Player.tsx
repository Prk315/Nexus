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
 * Public contract is `{ unitId, onClose }` (unit mode — unchanged, every
 * existing caller keeps working with no edits) OR `{ proofId, onClose }`
 * (proof mode — LEARN_PLAN.md "Proof side-paths"). No other props, no
 * default export.
 *
 * ── Proof mode (2026-08-10) ──────────────────────────────────────────────
 * A proof unit's content is `UnitContent`-shaped, so it derives layers,
 * renders theory/practice/test and grades drills through the *exact same*
 * code path as a unit — `mode` only changes three things: which table
 * content/approve/demote read and write (`fetchProofContent` /
 * `approveProofContent` / `demoteProofContent` vs. their unit-content
 * counterparts), what graduating writes (`setProofProgress(id, "completed")`
 * — never `lr_unit_progress`, never heat-seeding; proof completion is side
 * content, concept credit already flowed through the identical
 * `handleGrade` every drill uses), and two chrome details: a "BEVIS" chip in
 * the header, and the graduation ceremony's eyebrow text
 * ("PROOF COMPLETE" instead of "MASTERED", concept chips suppressed — see
 * `player/Graduation.tsx`'s v3 comment). `lr_proof_progress`'s "in_progress"
 * write on first open lives in `PathPanel.tsx` (it already holds the current
 * progress status for every proof node, so it can guard against
 * downgrading a completed proof back to in_progress — see that file).
 *
 * Proof mode is kind-aware (LEARN_PLAN.md "Eksamensværksted", 2026-08-10): the
 * same `lr_proof_*` trio also carries `kind: "workshop"` rows (chapter-end
 * exam-technique units), content-shaped and graded identically to a proof —
 * only the header chip ("VÆRKSTED" instead of "BEVIS") and the graduation
 * eyebrow ("WORKSHOP COMPLETE" instead of "PROOF COMPLETE") differ. Since
 * `LrProofContentRow` carries no `kind` of its own (only `lr_proof_unit`
 * does, and this component never fetches that table — `PathPanel` already
 * has it from `fetchProofUnits()`), the caller threads it through the
 * optional `kind` prop rather than this component re-deriving it.
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
  ContentStatus,
  Drill,
  Grade,
  Lens,
  LrMemoryState,
  PracticeGroup,
  ProofUnitKind,
  UnitContent,
  UnitFlow,
} from "./types";
import {
  approveProofContent,
  approveUnitContent,
  demoteProofContent,
  demoteUnitContent,
  fetchMemoryStates,
  fetchProofContent,
  fetchSolvedDrillIds,
  fetchUnitContent,
  logAttempt,
  setProofProgress,
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

// Normalized shape both `LrUnitContentRow` and `LrProofContentRow` satisfy —
// everything past content-loading only ever needs these three fields, so the
// rest of the component doesn't have to branch on `mode` a second time.
interface ContentRow {
  version: number;
  status: ContentStatus;
  content: UnitContent;
}

type PlayerProps =
  | { unitId: number; onClose: () => void }
  // `kind` defaults to "proof" (the pre-existing behaviour) when omitted —
  // every current caller of proof mode is `PathPanel`, which always has the
  // entry's `kind` in hand and passes it explicitly; the default only
  // matters for future/incidental callers.
  | { proofId: number; kind?: ProofUnitKind; onClose: () => void };

export function Player(props: PlayerProps) {
  const mode: "unit" | "proof" = "unitId" in props ? "unit" : "proof";
  // The one entity id this Player instance is loading — a unit_id in unit
  // mode, a proof_id in proof mode. Every table read/write below branches on
  // `mode` to pick the right table, but shares this single id.
  const id = "unitId" in props ? props.unitId : props.proofId;
  const sideKind: ProofUnitKind = "proofId" in props ? (props.kind ?? "proof") : "proof";
  const { onClose } = props;

  const [row, setRow] = useState<ContentRow | null | undefined>(undefined); // undefined = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [solvedDrillIds, setSolvedDrillIds] = useState<Set<string>>(new Set());
  const [memoryCache, setMemoryCache] = useState<Record<string, LrMemoryState>>({});
  const [graduation, setGraduation] = useState<{ score: number; total: number } | null>(null);
  const resumedRef = useRef(false);

  // Curator draft → live control (KLADDE badge → "Godkend"). Human-only
  // transition per LEARN_PLAN.md — agents only ever write `draft`. State
  // machine: idle (draft, offer "Godkend") → confirming (inline "…→ live?")
  // → busy (in flight) → approved (green LIVE chip + ~5s undo, then nothing —
  // "status live" never shows a badge, per DESIGN.md §1.3).
  const [approveUi, setApproveUi] = useState<"idle" | "confirming" | "busy" | "approved" | "done">("idle");
  const approveUndoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (approveUndoTimerRef.current !== null) window.clearTimeout(approveUndoTimerRef.current);
    };
  }, []);

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
    const load = mode === "unit" ? fetchUnitContent(id) : fetchProofContent(id);
    load
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
  }, [mode, id]);

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
      if (mode === "unit") {
        await setUnitProgress(id, "mastered", new Date().toISOString());
        await Promise.all(
          allConceptIds.map(async (conceptId) => {
            const existing = memoryCache[conceptId] ?? defaultMemoryState("default", conceptId);
            const seeded = seedGraduationHeat(existing);
            await upsertMemory(seeded);
          })
        );
      } else {
        // Proof completion: `lr_proof_progress` only. Never
        // `lr_unit_progress`, never heat-seeding — concept credit already
        // flowed through the normal grading path above, and seeding heat
        // here would double-credit concepts that a proof's drills already
        // touched (LEARN_PLAN.md "Proof side-paths").
        await setProofProgress(id, "completed");
      }
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

  async function handleApprove() {
    if (!row) return;
    setApproveUi("busy");
    try {
      if (mode === "unit") await approveUnitContent(id, row.version);
      else await approveProofContent(id, row.version);
      setApproveUi("approved");
      if (approveUndoTimerRef.current !== null) window.clearTimeout(approveUndoTimerRef.current);
      // ~5s undo window, then the control disappears entirely — a live unit
      // gets no badge at all (DESIGN.md §1.3), so there is no "idle" state to
      // fall back into here.
      approveUndoTimerRef.current = window.setTimeout(() => setApproveUi("done"), 5000);
    } catch (e) {
      console.error("[learn] approveUnitContent failed", e);
      setApproveUi("idle");
    }
  }

  async function handleDemote() {
    if (!row) return;
    if (approveUndoTimerRef.current !== null) {
      window.clearTimeout(approveUndoTimerRef.current);
      approveUndoTimerRef.current = null;
    }
    setApproveUi("busy");
    try {
      if (mode === "unit") await demoteUnitContent(id, row.version);
      else await demoteProofContent(id, row.version);
      setApproveUi("idle");
    } catch (e) {
      console.error("[learn] demoteUnitContent failed", e);
      // Unknown DB state — fail toward still showing the undo option rather
      // than silently dropping back to "draft" when the demote may not have
      // taken (fail-toward-caution, same posture as the productivity stack).
      setApproveUi("approved");
    }
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

  // The DB row's own status — never mutated locally. `approveUi` layers the
  // in-flight/just-approved UI on top without waiting on a refetch.
  const contentIsDraft = row?.status === "draft";
  const title = content?.title || content?.unit_code || (mode === "unit" ? `Unit ${id}` : `Proof ${id}`);
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

            {/* Proof mode marker — distinguishes a side-path proof from the
                unit it branched off (LEARN_PLAN.md "Proof side-paths"), or a
                workshop from either ("Eksamensværksted", 2026-08-10). */}
            {mode === "proof" && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] bg-black/[0.05] text-[#6E6E78]">
                {sideKind === "workshop" ? "VÆRKSTED" : "BEVIS"}
              </span>
            )}

            {/* Draft → live curation control. Only ever shown on draft
                content (DESIGN.md §1.3: "Approved (not yet live): no badge.
                Only draft is badged" — a live unit shows nothing here). */}
            {contentIsDraft && approveUi === "idle" && (
              <>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.draft}`}
                >
                  KLADDE
                </span>
                <button
                  type="button"
                  onClick={() => setApproveUi("confirming")}
                  className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium text-[#6E6E78] underline decoration-black/15 underline-offset-2 active:text-[#1A1A24]"
                >
                  Godkend
                </button>
              </>
            )}

            {contentIsDraft && approveUi === "confirming" && row && (
              <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[10px] text-[#6E6E78]">
                <span className="whitespace-nowrap">
                  Godkend v{row.version} → live?
                </span>
                <button
                  type="button"
                  onClick={handleApprove}
                  aria-label="Bekræft godkendelse"
                  className={`rounded px-1.5 py-0.5 font-semibold ${FEEDBACK.correct}`}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setApproveUi("idle")}
                  aria-label="Annullér"
                  className="rounded px-1.5 py-0.5 text-[#6E6E78] active:text-[#1A1A24]"
                >
                  ✕
                </button>
              </span>
            )}

            {approveUi === "busy" && (
              <span className="shrink-0 text-[10px] text-[#6E6E78]">Opdaterer…</span>
            )}

            {approveUi === "approved" && (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.correct}`}
                >
                  LIVE
                </span>
                <button
                  type="button"
                  onClick={handleDemote}
                  className="text-[10px] text-[#6E6E78] underline decoration-black/15 underline-offset-2 active:text-[#1A1A24]"
                >
                  Fortryd
                </button>
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

      {row === null && !loadError && mode === "proof" && (
        // Quiet "unknown/not-ready" grammar, per DESIGN.md §4.2's doctrine for
        // this kind of state: dashed, dim, no red, no error tone — a proof
        // with no content row yet is an authoring-in-progress fact, not a
        // failure. LEARN_PLAN.md: the pilot proof content is authored
        // concurrently with this app slice.
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <div className="flex max-w-[22rem] items-center gap-3 rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-4">
            <span className="grid h-8 w-8 shrink-0 animate-[learn-pulse_2.6s_ease-in-out_infinite] place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]/45">
              ∴
            </span>
            <div className="min-w-0">
              <p className="text-[13px] text-[#1A1A24]/70">Ikke klar endnu</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E6E78]/60">
                This proof has no content yet.
              </p>
            </div>
          </div>
        </main>
      )}

      {row === null && (loadError || mode === "unit") && (
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
          // Proof mode: [] suppresses "Added to review" — a proof never adds
          // concepts to retention (see Graduation.tsx's v3 comment). Same
          // reasoning applies to a workshop — its drills already granted
          // concept credit through the normal grading path.
          conceptIds={mode === "unit" ? allConceptIds : []}
          label={mode === "unit" ? "MASTERED" : sideKind === "workshop" ? "WORKSHOP COMPLETE" : "PROOF COMPLETE"}
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
