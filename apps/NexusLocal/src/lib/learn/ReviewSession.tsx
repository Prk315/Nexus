/**
 * The review session overlay — LEARN_PLAN.md's Phase 3 `lr_learn_state`
 * contract, DESIGN.md §4's "Start review" hand-off. Player-like fullscreen
 * overlay (same frame/backdrop/dock language as `Player.tsx`, DESIGN.md §3.1
 * and the v2 soft-white paper theme, §7), but flat: no Theory/Practice/Test
 * stepper — just `api.fetchReviewQueue()`'s ~10 drills across due concepts,
 * straight through `DrillCard` (reused directly, not forked), one at a time.
 *
 * Grading is identical to Player.tsx's Practice step: `memory.applyGrade`
 * credited to every concept in the drill's own practice group, persisted via
 * `api.upsertMemory`, plus a lens-tagged `api.logAttempt`. This file does not
 * reimplement that logic differently — it is the same call sequence.
 *
 * Ends on a small "Session færdig" card: total drills reviewed, plus a
 * per-due-concept delta (value_mean before → after this session, and a
 * "stabil" chip the moment a concept crosses `memory.isStable` during the
 * session) — DESIGN.md's hue rules apply: no new hue, emerald only for the
 * existing "stable/correct" meaning.
 *
 * Own file, own contract: `{ onClose: () => void }`. `ReviewPanel.tsx` only
 * renders this behind a boolean flag; it does not reach into this file's
 * state.
 */

import { useEffect, useMemo, useState } from "react";
import type { Grade, Lens, LrMemoryState } from "./types";
import { fetchMemoryStates, fetchReviewQueue, logAttempt, upsertMemory, type ReviewQueueItem } from "./api";
import { applyGrade, defaultMemoryState, isStable, valueMean } from "./memory";
import { DrillCard } from "./player/DrillCard";
import { detectSourceLens, PLAYER_STYLE } from "./player/tokens";

export function ReviewSession({ onClose }: { onClose: () => void }) {
  // undefined = loading, null = lr_learn_state has no row at all ("ingen dom
  // endnu" — never treated as "nothing due"), [] = row exists, nothing to
  // drill right now (a real, different state from null).
  const [queue, setQueue] = useState<ReviewQueueItem[] | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [baseline, setBaseline] = useState<Record<string, LrMemoryState>>({});
  const [memoryCache, setMemoryCache] = useState<Record<string, LrMemoryState>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchReviewQueue()
      .then(async (q) => {
        if (!alive) return;
        setQueue(q);
        if (q && q.length > 0) {
          const conceptIds = Array.from(new Set(q.flatMap((item) => item.group.concept_ids)));
          try {
            const states = await fetchMemoryStates(conceptIds);
            if (!alive) return;
            setBaseline(states);
            setMemoryCache(states);
          } catch (e) {
            console.error("[learn] fetchMemoryStates failed", e);
          }
        }
      })
      .catch((e) => {
        console.error("[learn] fetchReviewQueue failed", e);
        if (alive) setQueue(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const total = queue?.length ?? 0;
  const current = queue && index < queue.length ? queue[index] : null;

  const reviewedConceptIds = useMemo(
    () => (queue ? Array.from(new Set(queue.map((item) => item.conceptId))) : []),
    [queue]
  );

  function handleGraded(grade: Grade) {
    if (!current || !queue) return;
    const drill = current.drill;
    const group = current.group;
    const lens: Lens = drill.lens;

    setMemoryCache((prev) => {
      const next = { ...prev };
      for (const conceptId of group.concept_ids) {
        const existing = prev[conceptId] ?? defaultMemoryState("default", conceptId);
        const updated = applyGrade(existing, grade, lens);
        next[conceptId] = updated;
        upsertMemory(updated).catch((e) => console.error("[learn] upsertMemory failed", e));
      }
      return next;
    });
    logAttempt({ itemRef: drill.id, lens, grade }).catch((e) => console.error("[learn] logAttempt failed", e));

    if (index + 1 < queue.length) {
      setIndex((n) => n + 1);
    } else {
      setDone(true);
    }
  }

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
          <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">Review</span>
          {total > 0 && !done && (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E78]">
              {Math.min(index + 1, total)} / {total}
            </span>
          )}
        </div>
        {total > 0 && !done && (
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-black/[0.07]">
            <span
              className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
              style={{ width: `${(index / total) * 100}%` }}
            />
          </div>
        )}
      </header>

      {queue === undefined && (
        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          <p className="text-[13px] text-[#6E6E78]">Loading…</p>
        </main>
      )}

      {queue === null && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="grid h-8 w-8 shrink-0 animate-pulse place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]">
            ?
          </span>
          <p className="text-[13px] text-[#1A1A24]/70">Ingen dom endnu</p>
          <p className="max-w-[240px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            The server hasn't computed a review verdict yet — there's nothing to drill from until it
            does.
          </p>
        </main>
      )}

      {queue !== undefined && queue !== null && queue.length === 0 && !done && (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[13px] text-[#1A1A24]/70">Nothing due right now.</p>
          <p className="max-w-[240px] text-[11px] leading-relaxed text-[#6E6E78]/80">
            All caught up — check back once more content is due for review.
          </p>
        </main>
      )}

      {queue && queue.length > 0 && !done && current && (
        <DrillCard
          key={current.drill.id}
          drill={current.drill}
          archetype={current.archetype}
          indexLabel={`Review ${index + 1} / ${total}`}
          translateFrom={
            current.archetype === "translate" ? detectSourceLens(current.drill.prompt_md) : null
          }
          onGraded={handleGraded}
        />
      )}

      {done && (
        <SessionEnd
          total={total}
          reviewedConceptIds={reviewedConceptIds}
          baseline={baseline}
          after={memoryCache}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function SessionEnd({
  total,
  reviewedConceptIds,
  baseline,
  after,
  onClose,
}: {
  total: number;
  reviewedConceptIds: string[];
  baseline: Record<string, LrMemoryState>;
  after: Record<string, LrMemoryState>;
  onClose: () => void;
}) {
  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-4 pb-40 text-center">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-2xl text-white shadow-[0_0_22px_-6px_rgba(217,70,239,0.5)]">
          ✓
        </span>
        <p className="mt-4 bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-[11px] font-semibold tracking-[0.32em] text-transparent">
          SESSION FÆRDIG
        </p>
        <p className="text-[13px] text-[#6E6E78]">
          {total} drill{total === 1 ? "" : "s"} reviewed
        </p>

        {reviewedConceptIds.length > 0 && (
          <div className="mt-5 flex w-full max-w-sm flex-col gap-1.5 text-left">
            {reviewedConceptIds.map((id, i) => {
              const before = baseline[id];
              const post = after[id] ?? before;
              const beforeMean = before ? valueMean(before.value_alpha, before.value_beta) : null;
              const afterMean = post ? valueMean(post.value_alpha, post.value_beta) : null;
              const delta = beforeMean !== null && afterMean !== null ? afterMean - beforeMean : null;
              const wasStable = before ? isStable(before) : false;
              const nowStable = post ? isStable(post) : false;
              return (
                <div
                  key={id}
                  className="flex animate-[learn-step-in_.18s_ease-out] items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px] shadow-[0_1px_6px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05]"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="min-w-0 flex-1 truncate text-[#1A1A24]/75">{id}</span>
                  {!wasStable && nowStable && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 ring-1 ring-emerald-500/25">
                      stabil
                    </span>
                  )}
                  {delta !== null && (
                    <span
                      className={`shrink-0 font-mono text-[11px] tabular-nums ${
                        delta >= 0 ? "text-emerald-700" : "text-[#6E6E78]"
                      }`}
                    >
                      {delta >= 0 ? "+" : ""}
                      {Math.round(delta * 100)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Continue →
          </button>
        </div>
      </footer>
    </>
  );
}
