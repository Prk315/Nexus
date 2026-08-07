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
 */

import { PathPanel } from "./PathPanel";
import { ReviewPanel } from "./ReviewPanel";

export function LearnPage() {
  return (
    <div className="-mx-6 -mb-6 flex-1 overflow-y-auto bg-[#F6F5F1] text-[#1A1A24]">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 pb-16 pt-6 sm:px-6">
        <PathPanel />
        <ReviewPanel />
      </div>
    </div>
  );
}
