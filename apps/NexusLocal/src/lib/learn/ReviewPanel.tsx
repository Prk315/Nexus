/**
 * The review section — DESIGN.md §4. Streak + due count from `lr_learn_state`
 * (the `blocking_state` doctrine: a missing row means "never computed", never
 * "nothing due" — §4.2's "Ingen dom endnu" state), plus a "Start review"
 * action that opens `ReviewSession` — a flat, concept-level drill sequence
 * built by `api.fetchReviewQueue()` from `lr_learn_state.due_concepts` (see
 * that function's doc comment for the selection rules: unit content lookup,
 * least-seen-lens preference, least-attempted tiebreak).
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. Renders on
 * `#F6F5F1` paper (painted by `LearnPage`); ink/muted tokens replace the
 * `white/NN` opacity ladder from the dark theme.
 *
 * The "Start review" button stays enabled even in the missing-verdict state
 * (DESIGN.md §4.2) — `ReviewSession` calls `fetchReviewQueue()` itself and
 * renders its own "Ingen dom endnu" card when the row truly doesn't exist,
 * so this component doesn't need to special-case that here; it only decides
 * *whether the session is open*, never what it shows once open.
 *
 * What's wired to `memory.ts` here (outside the session itself): when a
 * verdict has `due_concepts`, their memory states are fetched
 * (`api.fetchMemoryStates`) and `memory.isStable` colours a small "stabile"
 * sub-label under the due count — fill/weight, not a new hue, per DESIGN.md
 * §0 rule 3.
 */

import { useEffect, useState } from "react";
import { fetchLearnState, fetchMemoryStates } from "./api";
import { isStable } from "./memory";
import type { LrLearnState } from "./types";
import { ReviewSession } from "./ReviewSession";

const LAST_KNOWN_KEY = "learn:review:lastKnownState";

function minutesAgoLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "computed just now";
  if (mins < 60) return `computed ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `computed ${hours}h ago`;
  return `computed ${Math.floor(hours / 24)}d ago`;
}

/**
 * 7 booleans, oldest → newest, today last (design: "today is the last dot").
 * There is no daily-activity array in `lr_learn_state` — only `streak_days`
 * and `last_session_date` — so this reconstructs the strip from those two
 * fields rather than fabricating data: if the streak is "live" (last session
 * today or yesterday), the most recent `streak_days` days are marked done,
 * ending at `last_session_date`. A stale/broken streak renders all-empty
 * rather than guessing.
 */
function weekDots(streakDays: number | null, lastSessionDate: string | null): boolean[] {
  const dots = new Array(7).fill(false);
  if (!lastSessionDate || !streakDays || streakDays <= 0) return dots;
  const last = new Date(`${lastSessionDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAgoOfLast = Math.round((today.getTime() - last.getTime()) / 86_400_000);
  if (daysAgoOfLast < 0 || daysAgoOfLast > 1) return dots;
  for (let i = 0; i < streakDays && i < 7; i++) {
    const idx = 6 - (daysAgoOfLast + i);
    if (idx >= 0 && idx < 7) dots[idx] = true;
  }
  return dots;
}

export function ReviewPanel() {
  // undefined = still loading, null = row missing ("ingen dom endnu").
  const [verdict, setVerdict] = useState<LrLearnState | null | undefined>(undefined);
  const [lastKnown, setLastKnown] = useState<LrLearnState | null>(null);
  const [stability, setStability] = useState<{ stable: number; total: number } | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let v: LrLearnState | null;
      try {
        v = await fetchLearnState();
      } catch {
        if (!cancelled) setVerdict(null);
        return;
      }
      if (cancelled) return;
      setVerdict(v);

      if (v) {
        try {
          localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(v));
        } catch {
          // best-effort cache only
        }
        setLastKnown(v);

        if (v.due_concepts && v.due_concepts.length > 0) {
          try {
            const states = await fetchMemoryStates(v.due_concepts.map((d) => d.concept_id));
            if (cancelled) return;
            const entries = Object.values(states);
            setStability({ stable: entries.filter((s) => isStable(s)).length, total: entries.length });
          } catch {
            if (!cancelled) setStability(null);
          }
        } else {
          setStability(null);
        }
      } else {
        try {
          const raw = localStorage.getItem(LAST_KNOWN_KEY);
          if (raw) setLastKnown(JSON.parse(raw) as LrLearnState);
        } catch {
          // no cached verdict available — falls through to the plain unknown state
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-[#6E6E78]">Review</h2>

      {verdict === undefined && (
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 text-center text-[12px] text-[#6E6E78]/70 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          Loading…
        </div>
      )}

      {verdict !== undefined && verdict !== null && (
        <>
          <VerdictStats verdict={verdict} stability={stability} />
          {(verdict.due_concepts?.length ?? 0) === 0 && verdict.computed_at ? (
            <button
              type="button"
              disabled
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-black/[0.05] px-3 py-2 text-[13px] text-[#1A1A24]/70"
            >
              All caught up
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSessionOpen(true)}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
            >
              {`Start review${verdict.due_concepts?.length ? ` · ${verdict.due_concepts.length}` : ""}`}
            </button>
          )}
          <div className="text-[10px] text-[#6E6E78]/60">{minutesAgoLabel(verdict.computed_at)}</div>
        </>
      )}

      {verdict === null && (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-black/[0.12] bg-black/[0.02] p-3">
            <span className="grid h-8 w-8 shrink-0 animate-pulse place-items-center rounded-full bg-black/[0.04] text-[#6E6E78]/70">
              ?
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-[#1A1A24]/70">Ingen dom endnu</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#6E6E78]/80">
                The server hasn’t computed a review verdict yet. This does{" "}
                <em className="not-italic text-[#1A1A24]/70">not</em> mean nothing is due.
              </p>
            </div>
          </div>

          {lastKnown && (
            <div className="opacity-60">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-[#6E6E78]">
                  last known
                </span>
              </div>
              <VerdictStats verdict={lastKnown} stability={null} />
            </div>
          )}

          <button
            type="button"
            onClick={() => setSessionOpen(true)}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Start review
          </button>
        </>
      )}

      {sessionOpen && <ReviewSession onClose={() => setSessionOpen(false)} />}
    </section>
  );
}

function VerdictStats({
  verdict,
  stability,
}: {
  verdict: LrLearnState;
  stability: { stable: number; total: number } | null;
}) {
  const streak = verdict.streak_days ?? 0;
  const due = verdict.due_concepts?.length ?? 0;
  const dots = weekDots(verdict.streak_days, verdict.last_session_date);

  return (
    <div className="flex items-stretch gap-3 rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <div className="flex flex-col justify-between">
        <div
          className={`font-mono text-3xl font-semibold leading-none tabular-nums ${
            streak > 0 ? "bg-gradient-to-br from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent" : "text-[#6E6E78]/50"
          }`}
        >
          {streak}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]/80">day streak</div>
      </div>

      <div className="flex items-end gap-1 self-center">
        {dots.map((done, i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-full ${done ? "bg-gradient-to-br from-indigo-400 to-fuchsia-500" : "bg-black/[0.08]"} ${
              i === dots.length - 1 ? "ring-2 ring-black/15 ring-offset-2 ring-offset-white" : ""
            }`}
          />
        ))}
      </div>

      <div className="ml-auto text-right">
        <div className="font-mono text-3xl font-semibold leading-none tabular-nums text-[#1A1A24]/90">{due}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#6E6E78]/80">concepts due</div>
        {stability && stability.total > 0 && (
          <div className="mt-1 text-[9px] text-[#6E6E78]/60">
            {stability.stable}/{stability.total} stabile
          </div>
        )}
      </div>
    </div>
  );
}
