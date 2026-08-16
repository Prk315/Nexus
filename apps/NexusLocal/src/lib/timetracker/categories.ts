/**
 * The shared activity taxonomy.
 *
 * Phase A uses these as the one-tap chips on unaccounted gaps; Phase E of
 * DAY_COVERAGE_ROADMAP.md turns the same strings into `coverage_categories`
 * rows and hangs app→category and block→category mappings off them. That is
 * why this list lives in its own module and why the names must not be edited
 * casually once blocks exist — a renamed category orphans every block logged
 * under the old title.
 *
 * `color` is a PathFinder BLOCK_COLORS key (Week view falls back to teal for
 * unknown names, so a typo degrades visibly rather than breaking).
 * `onscreen` marks categories where heavy screen time inside the block is
 * expected — the honesty check skips those.
 */
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
