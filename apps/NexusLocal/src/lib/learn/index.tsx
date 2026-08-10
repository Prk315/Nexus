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
 */

import { PathPanel } from "./PathPanel";
import { ReviewPanel } from "./ReviewPanel";

export function LearnPage() {
  return (
    <div className="-mx-6 -mb-6 flex-1 overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 md:max-w-2xl md:gap-10 md:px-8 md:pb-24 md:pt-10">
        <PathPanel />
        <ReviewPanel />
      </div>
    </div>
  );
}
