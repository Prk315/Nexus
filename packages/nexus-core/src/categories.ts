/**
 * The shared activity taxonomy, plus the pure logic that turns raw spans into
 * per-category totals.
 *
 * Phase A uses `CATEGORIES` as the one-tap chips on unaccounted gaps; Phase E
 * of DAY_COVERAGE_ROADMAP.md turns the same strings into `coverage_categories`
 * rows (seeded verbatim from this constant — see the migration) and hangs
 * app→category (`app_category_map`) and block→category (`pf_cal_blocks.category`)
 * mappings off them. That is why this list lives in its own module and why the
 * names must not be edited casually once blocks exist — a renamed category
 * orphans every block logged under the old title.
 *
 * `color` is a PathFinder BLOCK_COLORS key (Week view falls back to teal for
 * unknown names, so a typo degrades visibly rather than breaking).
 * `onscreen` marks categories where heavy screen time inside the block is
 * expected — the honesty check in DayCoveragePanel skips those.
 *
 * This file is deep-aliased as `@nexus/core/categories` (see NexusLocal's
 * vite.config.ts / tsconfig.json) rather than pulled through the `@nexus/core`
 * barrel, same reasoning as `coverage.ts`: the barrel drags in three.js.
 */

import { type Span, clip, gapsIn, totalSeconds, union } from "./coverage";

export type Category = {
  name: string;
  color: string;
  emoji: string;
  onscreen: boolean;
};

export const CATEGORIES: Category[] = [
  { name: "Deep work", color: "blue", emoji: "🎯", onscreen: true },
  { name: "Training", color: "green", emoji: "🏋️", onscreen: false },
  { name: "Reading", color: "violet", emoji: "📖", onscreen: false },
  { name: "Social", color: "pink", emoji: "👥", onscreen: false },
  { name: "Errands", color: "orange", emoji: "🚗", onscreen: false },
  { name: "Meals", color: "emerald", emoji: "🍽️", onscreen: false },
  { name: "Rest", color: "teal", emoji: "🌙", onscreen: false },
];

/** Pseudo-category for screen time from an app with no `app_category_map` row. */
export const UNCATEGORIZED = "Uncategorized";

/**
 * The part of `span` not covered by any of `spans` — the complement of
 * `spans` within `span`'s own bounds. `gapsIn` already computes exactly this
 * (the complement of a covered set within a window); this is a thin,
 * intention-revealing wrapper for the attribution rules below.
 */
export function subtract(span: Span, spans: Span[]): Span[] {
  return gapsIn(spans, span.start, span.end);
}

/** Case-insensitive "title starts with the category name" fallback match. */
function titlePrefixCategory(title: string): string | null {
  const lower = title.toLowerCase();
  const hit = CATEGORIES.find((c) => lower.startsWith(c.name.toLowerCase()));
  return hit ? hit.name : null;
}

export type ScreenAppSpans = { name: string; spans: Span[] };
export type PlannedBlock = { category: string | null; title: string; span: Span };

export type CategoryTotalsInput = {
  /** Per-app screen spans (app name -> that app's foreground intervals). */
  screen: ScreenAppSpans[];
  /** PathFinder calendar blocks (one-off + recurring, already expanded). */
  planned: PlannedBlock[];
  /** Garmin training sessions. */
  training: Span[];
  /** process_name -> category name, from `app_category_map`. */
  appMap: Map<string, string>;
  /** Everything is clipped to this window before being counted. */
  window: Span;
};

/**
 * Attribute a day's (or week's) spans to categories and sum seconds per
 * category. The contract, in order of application:
 *
 * 1. Screen spans attribute via `appMap`; an app with no mapping falls into
 *    the pseudo-category `UNCATEGORIZED` rather than being dropped, so
 *    "where did the day go" always accounts for 100% of screen time.
 * 2. Planned blocks attribute via their `category` field; when that is null,
 *    fall back to a case-insensitive "title starts with the category name"
 *    match (the same looseness `pf_cal_blocks.category` was given instead of
 *    a FK). Still no match -> the block is ignored for totals entirely (not
 *    Uncategorized — an untitled/uncategorized *plan* is not the same claim
 *    as unmapped *screen time*).
 * 3. Screen evidence beats plan: a planned block only contributes the part of
 *    its span NOT already covered by (any) screen activity — what you
 *    actually did, not what was merely scheduled. Implemented as
 *    `subtract(block.span, allScreenSpans)`.
 * 4. Garmin training spans are counted as `Training` evidence directly, with
 *    no subtraction — unlike a planned block, a completed Garmin activity is
 *    itself the evidence, not a plan that might not have happened.
 * 5. Within each category, all contributed spans are `union()`-ed before
 *    summing, so a Training block that overlaps its own Garmin session (rule
 *    3's leftover plus rule 4's evidence landing on the same category) is not
 *    double-counted.
 * 6. Sleep is deliberately NOT an input to this function — it has its own
 *    band in DayCoveragePanel and would otherwise drown out `Rest`.
 */
export function categoryTotals(input: CategoryTotalsInput): Map<string, number> {
  const { screen, planned, training, appMap, window } = input;

  const byCategory = new Map<string, Span[]>();
  const contribute = (category: string, span: Span | null) => {
    if (!span) return;
    const clipped = clip(span, window.start, window.end);
    if (!clipped) return;
    const list = byCategory.get(category);
    if (list) list.push(clipped);
    else byCategory.set(category, [clipped]);
  };

  // Rule 1 — screen spans via appMap, unmapped -> Uncategorized. Also collect
  // every screen span (clipped to the window) for rule 3's subtraction.
  const allScreenSpans: Span[] = [];
  for (const app of screen) {
    const category = appMap.get(app.name) ?? UNCATEGORIZED;
    for (const s of app.spans) {
      contribute(category, s);
      const clipped = clip(s, window.start, window.end);
      if (clipped) allScreenSpans.push(clipped);
    }
  }

  // Rules 2 + 3 — planned blocks, category column or title-prefix fallback,
  // minus whatever screen evidence already covers.
  for (const block of planned) {
    const category = block.category ?? titlePrefixCategory(block.title);
    if (!category) continue;
    const clippedSpan = clip(block.span, window.start, window.end);
    if (!clippedSpan) continue;
    for (const remaining of subtract(clippedSpan, allScreenSpans)) {
      contribute(category, remaining);
    }
  }

  // Rule 4 — Garmin training is its own evidence, no subtraction.
  for (const t of training) contribute("Training", t);

  // Rule 5 — union within each category before summing.
  const out = new Map<string, number>();
  for (const [category, spans] of byCategory) {
    out.set(category, totalSeconds(union(spans)));
  }
  return out;
}
