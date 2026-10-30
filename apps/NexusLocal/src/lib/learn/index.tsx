/**
 * Barrel for the Learn feature. `LearnPage` is the full page mounted from
 * `App.tsx` when its `page` state is `"learn"` (App.tsx owns a lightweight
 * `"node" | "learn"` switcher, no router lib — see App.tsx's header/nav).
 * Panels register here — one entry per line — never in `App.tsx`.
 *
 * v2 (2026-08-07): Learn became its own page (it was a stacked
 * `<LearnPanels />` mount below the node dashboard before) and switched to
 * the soft-white "paper" theme — DESIGN.md §7. `App.tsx`'s outer container
 * is dark (`#0a0a0f`) and stays that way for the node dashboard; this
 * wrapper paints its own `#F6F5F1` paper background full-bleed so nothing
 * dark leaks through at the edges. `-mx-6 -mb-6` cancels the parent's
 * `p-6` padding on the sides and bottom (App.tsx's flex column), and
 * `flex-1` lets it fill the remaining viewport height below the shared
 * header/nav — the same trick as a `fixed inset-0` layer without covering
 * the chrome above it.
 *
 * v3 (2026-08-10): desktop reading layout — DESIGN.md §8. The page keeps ONE
 * centred column at every width (`max-w-xl` → `md:max-w-2xl`) rather than
 * fanning the spine and the review card out side-by-side on a wide Mac
 * window. The spine is the hero and the review card is its footer stat; a
 * two-column split at 2000px would leave both floating in the middle of
 * nowhere. Wide windows buy margin, not more columns.
 *
 * v4 (2026-08-11): multi-course — LEARN_PLAN.md "App course support".
 * `CourseProvider` wraps the whole page so every panel below (and every
 * `player/` primitive `PathPanel`'s `Player` mounts) resolves the active
 * course via `CourseContext.useCourse()` with zero prop-drilling — the
 * course switcher itself lives in `PathPanel`'s header (the page's one
 * course-scoped spine), not as a second control here.
 *
 * v5 (2026-09-29): two tabs. The composed learning day (Today + Review) is
 * NOT course material — it spans every course and the exam books — yet it
 * rendered stacked above and below the LA path, which read as "part of the
 * Lineær Algebra course" and buried Review under 28 path units. "Today" is
 * now the default tab (the daily surfaces); "Kursus" holds the
 * course-scoped spine and its session panels. The choice sticks per device
 * in localStorage — a preference, not state worth syncing.
 */

import { useState } from "react";
import { CourseProvider } from "./CourseContext";
import { TodayPanel } from "./TodayPanel";
import { PathPanel } from "./PathPanel";
import { ReviewPanel } from "./ReviewPanel";
import { RoadmapTree, CourseCards } from "./RoadmapPanel";
import { IOChart } from "./IOChart";
import { useRoadmap } from "./roadmapData";
import { OverviewStrip } from "./OverviewStrip";
import { MathKeyboardBar } from "./MathKeyboardBar";
import { ToolDock } from "./tools/ToolDock";
import { InfinitePanel } from "./InfinitePanel";
import { ExamPanel } from "./ExamPanel";
import { ChallengePanel } from "./ChallengePanel";
import { SprintPanel } from "./SprintPanel";
import { StatsPanel } from "./StatsPanel";
import { CodePanel } from "./code/CodePractice";
import { RexOralPanel } from "./RexOralPanel";

/**
 * v6 (2026-10-05): separation + overblik. Three tabs, one concern each —
 * "I dag" is the DO surface (the composed day + repetition), "Roadmap" is
 * the PLAN surface (countdowns, book progress, lesson curriculum), and
 * "Kursus" keeps the course-scoped spine and its session panels. Above all
 * three sits the OverviewStrip: one chip per course and the nearest graded
 * deadline, so the glanceable answer to "hvor er jeg, og hvad brænder?"
 * never requires picking the right tab first.
 */
type LearnTab = "overblik" | "course";

function readTab(): LearnTab {
  try {
    return localStorage.getItem("nl-learn-tab") === "course" ? "course" : "overblik";
  } catch {
    return "overblik";
  }
}

export function LearnPage() {
  const [tab, setTab] = useState<LearnTab>(readTab);
  const pick = (t: LearnTab) => {
    setTab(t);
    try { localStorage.setItem("nl-learn-tab", t); } catch { /* per-device convenience */ }
  };
  const pill = (t: LearnTab, label: string) => (
    <button
      onClick={() => pick(t)}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
        tab === t ? "bg-white text-[#1A1A24] shadow-sm" : "text-[#6E6E78] hover:text-[#1A1A24]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <CourseProvider>
      {/* Global på touch: klæber til ethvert fokuseret tekstfelt i Learn. */}
      <MathKeyboardBar />
      {/* Universel Calc/Python-dock — virker også oven på Review-overlayet. */}
      <ToolDock />
      <div className="-mx-6 -mb-6 flex-1 overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
        <div className={`mx-auto flex flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 md:gap-8 md:px-8 md:pb-24 md:pt-10 ${
          tab === "overblik" ? "max-w-6xl" : "max-w-xl md:max-w-2xl"}`}>
          <OverviewStrip />
          <div className="flex justify-center">
            <div className="flex gap-1 rounded-full bg-[#EBEAE5] p-1">
              {pill("overblik", "Overblik")}
              {pill("course", "Kursus")}
            </div>
          </div>
          {tab === "overblik" ? (
            <OverblikLayout onOpenCourseTab={() => pick("course")} />
          ) : (
            <>
              <PathPanel />
              <ChallengePanel />
              <SprintPanel />
              <InfinitePanel />
              <StatsPanel />
            </>
          )}
        </div>
      </div>
    </CourseProvider>
  );
}

/** MatAn-eksamenstræningen er et Artifact (fuld AI-tutor på Bastians egen
 *  Claude-subscription via sample — samme mønster som Concept
 *  Module-lektionerne og REX Censor), så appen bærer kun linket. 9
 *  opgavetyper fra eksamenssættene 2020–22 + prøveeksamenen, 39 aktive
 *  varianter, 34 guidede trin. */
function MatAnTutorCard() {
  return (
    <section className="rounded-2xl border border-[#E3E2DC] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">MatAn · Eksamenstutor</h2>
          <p className="mt-0.5 text-xs text-black/50">
            9 opgavetyper · 39 aktive varianter med AI-censor · prøveeksamen 5. nov
          </p>
        </div>
        <a href="https://claude.ai/artifact/Qwyn8mky2X1hQ7a1SNbFxT" target="_blank" rel="noreferrer"
          className="shrink-0 rounded-lg bg-[#1A1A24] px-3 py-2 text-xs font-semibold text-white">
          Åbn tutoren ↗
        </a>
      </div>
    </section>
  );
}

/** Overblik: I/O-grafen øverst, derunder to kolonner — træet til venstre,
 *  dagen+review+kursuskort i den dobbelt så brede højrekolonne. På smalle
 *  skærme stakkes med GØR-fladen først; træet er planlægning. */
function OverblikLayout({ onOpenCourseTab }: { onOpenCourseTab: () => void }) {
  const { series } = useRoadmap();
  return (
    <>
      {series && <IOChart input={series.input} output={series.output} />}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
              <div className="order-2 lg:order-1 lg:col-span-1 lg:sticky lg:top-4">
                <RoadmapTree />
              </div>
              <div className="order-1 flex flex-col gap-6 lg:order-2 lg:col-span-2">
                <TodayPanel onOpenCourseTab={onOpenCourseTab} />
                <ExamPanel />
                <MatAnTutorCard />
                <ReviewPanel />
                <RexOralPanel />
                <CodePanel />
                <hr className="border-[#E3E2DC]" />
                <CourseCards />
              </div>
            </div>
    </>
  );
}
