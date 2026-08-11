import type { NutritionGoalItem } from "../store/types";

/** A goal is "active" (constrains the score) once it has a floor or a ceiling. */
export function isActiveGoal(g: { min_value: number | null; max_value: number | null }): boolean {
  return g.min_value != null || g.max_value != null;
}

/** The single representative target for a goal — used where one number is needed
 *  (a progress ring, a reference line): the ceiling if set, else the floor. */
export function goalTarget(g?: { min_value: number | null; max_value: number | null } | null): number | null {
  if (!g) return null;
  return g.max_value ?? g.min_value ?? null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * How well a day's intake `x` satisfies one goal, 0–100.
 *  - within [min, max]         → 100
 *  - below a floor (min)       → linear from 0 (at x=0) to 100 (at x=min)
 *  - above a ceiling (max)     → linear from 100 (at x=max) to 0 (at x=2·max)
 * A goal with neither bound doesn't constrain anything → 100.
 */
export function goalCloseness(x: number, min: number | null, max: number | null): number {
  if (min != null && x < min) return clamp(min > 0 ? (x / min) * 100 : 100);
  if (max != null && x > max) return clamp(max > 0 ? 100 - ((x - max) / max) * 100 : 0);
  return 100;
}

/**
 * The day's nutrition score (0–100) = the average closeness across every active
 * goal. Returns null when no goals are set, so the caller can fall back.
 * `totals` is the day's summed nutrient values keyed by nutrient_key.
 */
export function nutritionScore(
  totals: Record<string, number | null> | undefined,
  goals: NutritionGoalItem[],
): number | null {
  const active = goals.filter(isActiveGoal);
  if (active.length === 0) return null;
  const sum = active.reduce(
    (s, g) => s + goalCloseness(Number(totals?.[g.nutrient_key] ?? 0), g.min_value, g.max_value),
    0,
  );
  return Math.round(sum / active.length);
}
