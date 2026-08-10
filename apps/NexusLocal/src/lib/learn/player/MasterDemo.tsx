/**
 * The worked example — one layer's `master_demo`, revealed one {what/why/how}
 * step at a time (DESIGN.md §3.4).
 *
 * Extracted verbatim from the former `PracticeStep.tsx` when the Player moved
 * to interleaved layers (DESIGN.md §9): the demo is now the *middle* beat of a
 * layer (theory → example → drills) rather than the head of a group inside one
 * long practice block, so it needs to be composable on its own.
 *
 * Owns only the reveal cursor; the caller decides what "done" and "skip" mean.
 */

import { useEffect, useRef, useState } from "react";
import type { MasterDemo } from "../types";
import { Markdown } from "../Markdown";
import { CARD, DOCK_SHELL, DOCK_STACK, MAIN_SHELL, READING_COL } from "./tokens";

export function MasterDemoView({
  demo,
  eyebrow,
  onSkip,
  skipLabel,
  onDone,
  doneLabel,
}: {
  demo: MasterDemo;
  eyebrow?: string;
  onSkip: () => void;
  skipLabel: string;
  onDone: () => void;
  doneLabel: string;
}) {
  const [revealed, setRevealed] = useState(1);
  const lastStepRef = useRef<HTMLLIElement | null>(null);
  const steps = demo.steps;
  const isLast = revealed >= steps.length;

  useEffect(() => {
    if (lastStepRef.current) {
      lastStepRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [revealed]);

  return (
    <>
      <main className={`${MAIN_SHELL} pb-40`}>
        <div className={READING_COL}>
          {eyebrow && (
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70 md:mb-3">
              {eyebrow}
            </p>
          )}
          <div className={`${CARD} p-3 md:p-7`}>
            <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/80 md:text-[16.5px]">
              {demo.prompt_md}
            </Markdown>
          </div>

          <ol className="relative mt-4 pl-1 md:mt-8">
            <div className="pointer-events-none absolute left-[11px] bottom-2 top-2 w-px bg-black/[0.08]" />
            <div
              className="pointer-events-none absolute left-[11px] top-2 w-px rounded-full bg-gradient-to-b from-indigo-500 to-fuchsia-500 transition-[height] duration-500 ease-out"
              style={{ height: `${(revealed / Math.max(steps.length, 1)) * 100}%` }}
            />
            {steps.slice(0, revealed).map((step, i) => {
              const isLatest = i === revealed - 1;
              return (
                <li
                  key={i}
                  ref={isLatest ? lastStepRef : undefined}
                  className="relative animate-[learn-step-in_.2s_ease-out] pb-4 pl-8"
                >
                  <span
                    className={`absolute left-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[10px] ${
                      isLatest
                        ? "bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white"
                        : "bg-black/[0.05] text-[#6E6E78] ring-1 ring-black/10"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div
                    className={`text-[14px] font-medium leading-snug md:text-[16px] ${
                      isLatest ? "text-[#1A1A24]/90" : "text-[#1A1A24]/55"
                    }`}
                  >
                    <Markdown>{step.what}</Markdown>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-[#6E6E78] md:text-[13.5px]">
                    <Markdown>{step.why}</Markdown>
                  </div>
                  <div className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-[14px] text-[#1A1A24]/80 ring-1 ring-black/[0.06] md:mt-3 md:rounded-xl md:px-5 md:py-4 md:text-[15.5px]">
                    <Markdown>{step.how}</Markdown>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </main>

      <footer className={DOCK_SHELL}>
        <div className={DOCK_STACK}>
          <button
            type="button"
            onClick={onSkip}
            className="flex min-h-[44px] items-center justify-center text-center text-[12px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
          >
            {skipLabel}
          </button>
          <button
            type="button"
            onClick={() => (isLast ? onDone() : setRevealed((n) => n + 1))}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            {isLast ? doneLabel : `Next step (${revealed + 1}/${steps.length})`}
          </button>
        </div>
      </footer>
    </>
  );
}
