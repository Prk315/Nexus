/**
 * Infinite exercises entry card — LEARN_PLAN.md's pinned "Infinite
 * exercises" section. Loads `api.fetchExercisePool()` once to show a live
 * count ("N opgaver"), a start button that opens `ExerciseSession`, and a
 * friendly empty state when this user has flagged every item in the pool.
 *
 * Refetches on session close so the count reflects any flags/attempts from
 * the session that just ended — the same "reload on close" relationship
 * `PathPanel.tsx` has to `Player.tsx` (`reloadNonce`), just via the effect's
 * own `sessionOpen` dependency instead of a separate nonce, since this panel
 * has nothing else that would trigger a reload.
 */

import { useEffect, useState } from "react";
import { fetchExercisePool } from "./api";
import { ExerciseSession } from "./ExerciseSession";

export function InfinitePanel() {
  // undefined = loading, null = the pool fetch failed.
  const [count, setCount] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    if (sessionOpen) return;
    let cancelled = false;
    setError(null);
    fetchExercisePool()
      .then((pool) => {
        if (!cancelled) setCount(pool.length);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionOpen]);

  return (
    <section className="flex flex-col gap-2 md:gap-3">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[#6E6E78] md:text-[13px]">∞ Infinite exercises</h2>

      {count === undefined && (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Loading…
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 ring-1 ring-red-500/20">{error}</div>
      )}

      {count !== undefined && (count === null || count === 0) && !error && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]/70">
            ∞
          </span>
          <div className="min-w-0">
            <div className="text-[13px] text-[#1A1A24]/70">No exercises left</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E6E78]/80">
              Every past-exam exercise in the pool is flagged for this account. Nothing left to shuffle right now.
            </p>
          </div>
        </div>
      )}

      {typeof count === "number" && count > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:gap-5 md:rounded-2xl md:p-5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-lg text-white shadow-[0_0_18px_-6px_rgba(217,70,239,0.5)] md:h-14 md:w-14 md:text-xl">
            ∞
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-2xl font-semibold tabular-nums text-[#1A1A24]/90 md:text-3xl">
              {count}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]/80">opgaver</div>
          </div>
          <button
            type="button"
            onClick={() => setSessionOpen(true)}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[13px] font-semibold text-white transition-transform active:scale-[0.985] md:px-5 md:text-[14px]"
          >
            Start →
          </button>
        </div>
      )}

      {sessionOpen && <ExerciseSession onClose={() => setSessionOpen(false)} />}
    </section>
  );
}
