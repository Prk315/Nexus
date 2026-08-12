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

// ── Weekly, dynamic-calorie scoring ─────────────────────────────────────────

/** Dynamic calorie target config. Each day's maintenance = base_bmr + that day's
 *  Oura active calories; the goal is (maintenance + offset), scored 100 within
 *  ±tolerance. All values are per-day kcal. */
export interface CalorieConfig {
  base_bmr: number;
  offset: number;
  tolerance: number;
}

/** Defaults so the dynamic calorie model is active out of the box, before the
 *  user has ever saved a calorie strategy (base 1800, maintain, ±200). */
export const DEFAULT_CALORIE_CONFIG: CalorieConfig = { base_bmr: 1800, offset: 0, tolerance: 200 };

/** Resolve a CalorieConfig from a stored activity-goals row, falling back to the
 *  defaults per field — always returns a usable config. */
export function calorieConfigFrom(
  goals: { base_bmr: number | null; calorie_offset: number | null; calorie_tolerance: number | null } | null | undefined,
): CalorieConfig {
  return {
    base_bmr: goals?.base_bmr ?? DEFAULT_CALORIE_CONFIG.base_bmr,
    offset: goals?.calorie_offset ?? DEFAULT_CALORIE_CONFIG.offset,
    tolerance: goals?.calorie_tolerance ?? DEFAULT_CALORIE_CONFIG.tolerance,
  };
}

/** 100 inside [lo, hi]; linear taper to 0 one tolerance-width outside. */
function bandCloseness(x: number, lo: number, hi: number, tol: number): number {
  if (x >= lo && x <= hi) return 100;
  const dist = x < lo ? lo - x : x - hi;
  return clamp(tol > 0 ? 100 - (dist / tol) * 100 : 0);
}

/**
 * Weekly nutrition score (0–100) over a set of dates — the average closeness
 * across the dynamic calorie goal and each weekly nutrient goal:
 *  - calories: the week's intake vs Σ(base + active + offset), within ±tol·days
 *  - other nutrients: the week's summed intake vs the goal's weekly min/max
 * Returns 0 if nothing was logged in the window, and (when no goals at all are
 * set) a plain calorie proxy so the ring isn't blank.
 */
export function weeklyNutritionScore(
  dates: string[],
  totalsByDate: Map<string, Record<string, number | null>>,
  activeCaloriesByDate: Map<string, number>,
  goals: NutritionGoalItem[],
  calorie: CalorieConfig | null,
): number {
  const weekTotals: Record<string, number> = {};
  let loggedCalories = 0;
  for (const d of dates) {
    const t = totalsByDate.get(d);
    if (!t) continue;
    for (const k of Object.keys(t)) weekTotals[k] = (weekTotals[k] ?? 0) + Number(t[k] ?? 0);
    loggedCalories += Number(t.calories ?? 0);
  }
  if (loggedCalories <= 0) return 0;

  const subs: number[] = [];
  if (calorie && calorie.base_bmr > 0) {
    let target = 0;
    for (const d of dates) target += calorie.base_bmr + Number(activeCaloriesByDate.get(d) ?? 0) + calorie.offset;
    const tolWeek = calorie.tolerance * dates.length;
    subs.push(bandCloseness(weekTotals.calories ?? 0, target - tolWeek, target + tolWeek, tolWeek));
  }
  for (const g of goals.filter(isActiveGoal)) {
    if (g.nutrient_key === "calories") continue; // calories is dynamic, handled above
    subs.push(goalCloseness(weekTotals[g.nutrient_key] ?? 0, g.min_value, g.max_value));
  }

  if (subs.length === 0) {
    return Math.min(100, Math.round(((weekTotals.calories ?? 0) / (2000 * dates.length)) * 100));
  }
  return Math.round(subs.reduce((a, b) => a + b, 0) / subs.length);
}
