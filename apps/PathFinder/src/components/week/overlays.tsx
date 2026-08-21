// The 'Actual' overlay — real screen/sleep/training time drawn behind the plan.

import { hm } from "@nexus/core/coverage";
import { cn } from "../../lib/utils";
import { ACTUAL_TRACKS, actualSpanPx } from "./_shared";
import type { Span } from "@nexus/core/coverage";
import type { ActualDay } from "../../lib/actual";

/** Background layer behind the timed events — same time grid, low opacity, non-interactive. */
export function ActualOverlay({ actual, iso }: { actual: ActualDay; iso: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {ACTUAL_TRACKS.flatMap(({ key, colorCls }) =>
        actual[key].map((span, i) => {
          const rect = actualSpanPx(span, iso);
          if (!rect) return null;
          return (
            <div
              key={`${key}-${i}`}
              className={cn("absolute left-0 right-0 rounded-sm opacity-[0.18]", colorCls)}
              style={{ top: rect.top, height: rect.height }}
            />
          );
        }),
      )}
    </div>
  );
}

/**
 * Sleep band — ALWAYS visible (independent of the "Actual" toggle, which
 * still gates screen + training). With a full 24h grid a night's sleep
 * naturally shows as the bed-time band at the bottom of one day column and
 * the rise-time band at the top of the next — that's the point of widening
 * the grid to begin with. Bed/rise times are labelled at the band's edges
 * when it's tall enough to hold them; that labelling (not just the tint) is
 * the actual feature request.
 */
export function SleepBand({ spans, iso }: { spans: Span[]; iso: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {spans.map((span, i) => {
        const rect = actualSpanPx(span, iso);
        if (!rect) return null;
        const showLabels = rect.height >= 28;
        return (
          <div
            key={i}
            className="absolute left-0 right-0 rounded-sm bg-indigo-400/[0.14] border-y border-indigo-400/20"
            style={{ top: rect.top, height: rect.height }}
          >
            {showLabels && (
              <>
                <span className="absolute left-1 top-0.5 text-[9px] leading-none tabular-nums text-indigo-500/80 dark:text-indigo-300/80">
                  {hm(span.start)}
                </span>
                <span className="absolute left-1 bottom-0.5 text-[9px] leading-none tabular-nums text-indigo-500/80 dark:text-indigo-300/80">
                  {hm(span.end)}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

