/**
 * Lynudfordring entry card — LEARN_PLAN.md's pinned "Lynudfordring — timed
 * challenge" section. Unscoped (whole unlocked course) — the chapter
 * checkpoint variant lives on `PathPanel.tsx`'s spine instead (2026-08-10
 * pilot, LA 2's end). Same shape as `InfinitePanel.tsx`: a live personal-best
 * readout, a start button that opens `ChallengeSession`, and a refetch on
 * session close so the best updates the moment a new record lands.
 */

import { useEffect, useState } from "react";
import { fetchChallengeBest } from "./api";
import type { LrChallengeRun } from "./types";
import { useCourse } from "./CourseContext";
import { ChallengeSession } from "./ChallengeSession";

export function ChallengePanel() {
  const { course } = useCourse();
  // Mirrors `ChallengeSession.tsx`'s own scope derivation exactly — LA keeps
  // its pre-multi-course `null` scope (so existing personal bests still
  // match), a non-LA course gets its own `"<key>:all"` bucket so a DBMS
  // record never masquerades as (or gets shadowed by) an LA one.
  const scope = course.key === "la" ? null : `${course.key}:all`;
  // undefined = loading, null = no record yet (or the fetch failed — either
  // way there is nothing to show but the un-decorated "start" state).
  const [best, setBest] = useState<LrChallengeRun | null | undefined>(undefined);
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    if (sessionOpen) return;
    let cancelled = false;
    setBest(undefined);
    fetchChallengeBest(scope)
      .then((b) => {
        if (!cancelled) setBest(b);
      })
      .catch((e) => {
        console.error("[learn] fetchChallengeBest failed", e);
        if (!cancelled) setBest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionOpen, scope]);

  return (
    <section className="flex flex-col gap-2 md:gap-3">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">⚡ Lynudfordring</h2>

      <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:gap-5 md:rounded-2xl md:p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-lg text-white shadow-[0_0_18px_-6px_rgba(217,70,239,0.5)] md:h-14 md:w-14 md:text-xl">
          ⚡
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[#1A1A24]/80">15 min · 3 runder</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[#6E6E78]/80">
            {best === undefined
              ? "Indlæser…"
              : best
                ? `Personlig rekord: ${best.score} point`
                : "Ingen rekord endnu"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSessionOpen(true)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[13px] font-semibold text-white transition-transform active:scale-[0.985] md:px-5 md:text-[14px]"
        >
          Start →
        </button>
      </div>

      {sessionOpen && <ChallengeSession onClose={() => setSessionOpen(false)} />}
    </section>
  );
}
