/**
 * The graduation ceremony (`Player.tsx` §3.7). Replaces the whole `<main>` —
 * no card, no scroll — for ~1.6s of staggered CSS-only motion. Fires once
 * when `Player.tsx` has already persisted the mastery (`setUnitProgress` +
 * heat seeding) — this component is purely the payoff, not the write path.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7. The disc stays
 * fully saturated (celebratory moments are the one place the palette is
 * allowed to stay loud); the inner hole and the surrounding text switch from
 * white-on-dark to ink-on-paper.
 */

import type { Lens } from "../types";
import { DOCK_SHELL, DOCK_STACK, LENS } from "./tokens";

const LENS_HEX: Record<Lens, string> = { row: "#22d3ee", matrix: "#818cf8", column: "#e879f9" };
const SHARD_LENSES: Lens[] = ["row", "matrix", "column"];

export function Graduation({
  title,
  drillsTotal,
  testScore,
  testTotal,
  estMinutes,
  exercisedLenses,
  conceptIds,
  onContinue,
}: {
  title: string;
  drillsTotal: number;
  testScore: number;
  testTotal: number;
  estMinutes: number;
  exercisedLenses: Set<Lens>;
  conceptIds: string[];
  onContinue: () => void;
}) {
  return (
    <>
      <main
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-40 text-center"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 50% 35%, rgba(99,102,241,0.16), transparent 70%)",
        }}
      >
        <div className="relative">
          <div className="relative h-[104px] w-[104px] animate-[learn-grad-disc_.9s_cubic-bezier(.16,1,.3,1)_both] rounded-full [animation-delay:60ms] [background:conic-gradient(from_0deg,#6366f1,#d946ef,#22d3ee,#6366f1)]">
            <div className="absolute inset-[3px] grid place-items-center rounded-full bg-[#F6F5F1]">
              <span className="text-3xl text-[#1A1A24]">✓</span>
            </div>
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 h-[10px] w-[2px] animate-[learn-grad-burst_.7s_ease-out_both] rounded-full [animation-delay:calc(120ms+var(--i)*18ms)]"
                style={
                  {
                    "--a": `${i * 30}deg`,
                    "--i": i,
                    backgroundColor: LENS_HEX[SHARD_LENSES[i % 3]],
                    transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(-52px)`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </div>

        <p
          className="mt-6 animate-[learn-step-in_.3s_ease-out_both] bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-[11px] font-semibold tracking-[0.42em] text-transparent [animation-delay:380ms]"
        >
          MASTERED
        </p>
        <p className="mt-1 animate-[learn-step-in_.3s_ease-out_both] text-lg font-semibold text-[#1A1A24]/90 [animation-delay:420ms]">
          {title}
        </p>

        <p
          className="mt-4 animate-[learn-step-in_.3s_ease-out_both] text-[13px] text-[#1A1A24]/60 [animation-delay:520ms]"
        >
          {drillsTotal} drills · {testScore}/{testTotal} test · {estMinutes} min
        </p>

        <div className="mt-3 flex animate-[learn-step-in_.3s_ease-out_both] gap-3 [animation-delay:600ms]">
          {(["row", "matrix", "column"] as Lens[]).map((l) => {
            const on = exercisedLenses.has(l);
            return (
              <span
                key={l}
                className={`inline-flex items-center gap-1 text-[11px] ${on ? "text-[#1A1A24]/80" : "text-[#6E6E78]/45"}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: on ? LENS_HEX[l] : "rgba(0,0,0,0.12)" }}
                />
                {LENS[l].label}
              </span>
            );
          })}
        </div>

        {conceptIds.length > 0 && (
          <div className="mt-6 max-w-full">
            <p className="text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Added to review</p>
            <div className="mt-2 flex max-w-[320px] flex-wrap justify-center gap-1.5 md:max-w-[34rem]">
              {conceptIds.map((id, i) => (
                <span
                  key={id}
                  className="animate-[learn-chip-rise_.35s_ease-out_both] rounded-full bg-black/[0.04] px-2 py-1 text-[10px] text-[#1A1A24]/70 ring-1 ring-black/10"
                  style={{ animationDelay: `${760 + i * 70}ms` }}
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          <button
            type="button"
            onClick={onContinue}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Continue →
          </button>
        </div>
      </footer>
    </>
  );
}
