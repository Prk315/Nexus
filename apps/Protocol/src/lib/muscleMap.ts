/**
 * Garmin's FIT SDK exercise_category enum (47 values, from the strength-training
 * workout editor) mapped to the muscle regions MuscleMap.tsx draws. Category is
 * the only field reliably present on every logged set — exercise_name (the
 * ~1,500-value sub-category) varies too much per category to map individually,
 * so this is a category-level approximation, not anatomically exact.
 *
 * Categories with no clear muscle attribution (pure cardio/agility, or so
 * generic at the category level that guessing would mislead more than help)
 * map to an empty array and are excluded from the heatmap.
 */

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves"
  | "traps";

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
  traps: "Traps",
};

const CATEGORY_TO_MUSCLES: Record<string, MuscleGroup[]> = {
  BANDED_EXERCISES: [],
  BATTLE_ROPE: ["shoulders"],
  BENCH_PRESS: ["chest", "triceps", "shoulders"],
  BIKE_OUTDOOR: [],
  CALF_RAISE: ["calves"],
  CARDIO: [],
  CARRY: ["forearms", "traps"],
  CHOP: ["obliques", "abs"],
  CORE: ["abs", "obliques"],
  CRUNCH: ["abs"],
  CURL: ["biceps"],
  DEADLIFT: ["back", "glutes", "hamstrings"],
  ELLIPTICAL: [],
  FLOOR_CLIMB: [],
  FLYE: ["chest"],
  HIP_RAISE: ["glutes", "hamstrings"],
  HIP_STABILITY: ["glutes"],
  HIP_SWING: ["glutes", "hamstrings"],
  HYPEREXTENSION: ["back", "glutes"],
  INDOOR_BIKE: [],
  LADDER: [],
  LATERAL_RAISE: ["shoulders"],
  LEG_CURL: ["hamstrings"],
  LEG_RAISE: ["abs"],
  LUNGE: ["quads", "glutes", "hamstrings"],
  OLYMPIC_LIFT: ["back", "quads", "shoulders", "glutes"],
  PLANK: ["abs"],
  PLYO: ["quads", "calves"],
  PULL_UP: ["back", "biceps"],
  PUSH_UP: ["chest", "triceps", "shoulders"],
  ROW: ["back", "biceps"],
  RUN: [],
  RUN_INDOOR: [],
  SANDBAG: ["back", "quads", "shoulders"],
  SHOULDER_PRESS: ["shoulders", "triceps"],
  SHOULDER_STABILITY: ["shoulders"],
  SHRUG: ["traps"],
  SIT_UP: ["abs"],
  SLED: ["quads", "glutes"],
  SLEDGE_HAMMER: ["shoulders", "abs"],
  SQUAT: ["quads", "glutes", "hamstrings"],
  STAIR_STEPPER: [],
  SUSPENSION: ["chest", "back", "abs"],
  TIRE: ["quads", "back", "shoulders"],
  TOTAL_BODY: ["chest", "back", "quads", "shoulders", "abs"],
  TRICEPS_EXTENSION: ["triceps"],
  WARM_UP: [],
};

export function categoryToMuscles(category: string): MuscleGroup[] {
  return CATEGORY_TO_MUSCLES[category.toUpperCase()] ?? [];
}

export const ALL_MUSCLE_GROUPS = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];

export interface MuscleStatus {
  lastTrainedDate: string | null;
  daysSince: number | null;
  sets7d: number;
  sets30d: number;
}

interface SetLike {
  date: string;
  category: string;
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00`).getTime();
  const b = new Date(`${toDate}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** One entry per muscle group, derived from raw logged sets — every category a
 * set's `category` maps to (via categoryToMuscles) gets credited for that set. */
export function computeMuscleStatus(
  sets: SetLike[],
  today: string,
): Record<MuscleGroup, MuscleStatus> {
  const result = {} as Record<MuscleGroup, MuscleStatus>;
  for (const group of ALL_MUSCLE_GROUPS) {
    result[group] = { lastTrainedDate: null, daysSince: null, sets7d: 0, sets30d: 0 };
  }

  for (const set of sets) {
    const muscles = categoryToMuscles(set.category);
    if (muscles.length === 0) continue;
    const age = daysBetween(set.date, today);
    if (age < 0) continue;

    for (const group of muscles) {
      const status = result[group];
      if (status.lastTrainedDate == null || set.date > status.lastTrainedDate) {
        status.lastTrainedDate = set.date;
        status.daysSince = age;
      }
      if (age <= 6) status.sets7d++;
      if (age <= 29) status.sets30d++;
    }
  }

  return result;
}

/** 1.0 = trained today, fading toward 0 by RECENCY_FADE_DAYS; null (never
 * trained) renders as an untouched outline by the caller. */
const RECENCY_FADE_DAYS = 14;

export function recencyIntensity(daysSince: number | null): number {
  if (daysSince == null) return 0;
  return Math.max(0, 1 - daysSince / RECENCY_FADE_DAYS);
}
