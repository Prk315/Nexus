import { MuscleType, type Muscle } from "body-highlighter";

/**
 * Garmin's FIT SDK exercise_category enum (47 values, from the strength-training
 * workout editor) mapped to `body-highlighter`'s muscle slugs. Category is the
 * only field reliably present on every logged set — exercise_name (the
 * ~1,500-value sub-category) varies too much per category to map individually,
 * so this is a category-level approximation, not anatomically exact.
 *
 * Categories with no clear muscle attribution (pure cardio/agility, or so
 * generic at the category level that guessing would mislead more than help)
 * map to an empty array and are excluded from the heatmap.
 */

export type MuscleGroup = Muscle;

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  [MuscleType.TRAPEZIUS]: "Trapezius",
  [MuscleType.UPPER_BACK]: "Upper Back",
  [MuscleType.LOWER_BACK]: "Lower Back",
  [MuscleType.CHEST]: "Chest",
  [MuscleType.BICEPS]: "Biceps",
  [MuscleType.TRICEPS]: "Triceps",
  [MuscleType.FOREARM]: "Forearms",
  [MuscleType.BACK_DELTOIDS]: "Rear Delts",
  [MuscleType.FRONT_DELTOIDS]: "Front Delts",
  [MuscleType.ABS]: "Abs",
  [MuscleType.OBLIQUES]: "Obliques",
  [MuscleType.ABDUCTOR]: "Adductors",
  [MuscleType.ABDUCTORS]: "Abductors",
  [MuscleType.HAMSTRING]: "Hamstrings",
  [MuscleType.QUADRICEPS]: "Quads",
  [MuscleType.CALVES]: "Calves",
  [MuscleType.GLUTEAL]: "Glutes",
  [MuscleType.HEAD]: "Head",
  [MuscleType.NECK]: "Neck",
  [MuscleType.KNEES]: "Knees",
  [MuscleType.LEFT_SOLEUS]: "Left Soleus",
  [MuscleType.RIGHT_SOLEUS]: "Right Soleus",
};

/** Only the groups a Garmin category can ever map to — the anatomical extras
 * (head, neck, knees, soleus) never appear as sync output, so they're excluded
 * from the UI's "every group gets a legend row" list. */
export const TRACKED_MUSCLE_GROUPS: MuscleGroup[] = [
  MuscleType.CHEST,
  MuscleType.UPPER_BACK,
  MuscleType.LOWER_BACK,
  MuscleType.FRONT_DELTOIDS,
  MuscleType.BACK_DELTOIDS,
  MuscleType.BICEPS,
  MuscleType.TRICEPS,
  MuscleType.FOREARM,
  MuscleType.ABS,
  MuscleType.OBLIQUES,
  MuscleType.TRAPEZIUS,
  MuscleType.GLUTEAL,
  MuscleType.ABDUCTORS,
  MuscleType.QUADRICEPS,
  MuscleType.HAMSTRING,
  MuscleType.CALVES,
];

const CATEGORY_TO_MUSCLES: Record<string, MuscleGroup[]> = {
  BANDED_EXERCISES: [],
  BATTLE_ROPE: [MuscleType.FRONT_DELTOIDS, MuscleType.BACK_DELTOIDS],
  BENCH_PRESS: [MuscleType.CHEST, MuscleType.TRICEPS, MuscleType.FRONT_DELTOIDS],
  BIKE_OUTDOOR: [],
  CALF_RAISE: [MuscleType.CALVES],
  CARDIO: [],
  CARRY: [MuscleType.FOREARM, MuscleType.TRAPEZIUS],
  CHOP: [MuscleType.OBLIQUES, MuscleType.ABS],
  CORE: [MuscleType.ABS, MuscleType.OBLIQUES],
  CRUNCH: [MuscleType.ABS],
  CURL: [MuscleType.BICEPS],
  DEADLIFT: [MuscleType.LOWER_BACK, MuscleType.GLUTEAL, MuscleType.HAMSTRING],
  ELLIPTICAL: [],
  FLOOR_CLIMB: [],
  FLYE: [MuscleType.CHEST],
  HIP_RAISE: [MuscleType.GLUTEAL, MuscleType.HAMSTRING],
  HIP_STABILITY: [MuscleType.ABDUCTORS],
  HIP_SWING: [MuscleType.GLUTEAL, MuscleType.HAMSTRING],
  HYPEREXTENSION: [MuscleType.LOWER_BACK, MuscleType.GLUTEAL],
  INDOOR_BIKE: [],
  LADDER: [],
  LATERAL_RAISE: [MuscleType.FRONT_DELTOIDS, MuscleType.BACK_DELTOIDS],
  LEG_CURL: [MuscleType.HAMSTRING],
  LEG_RAISE: [MuscleType.ABS],
  LUNGE: [MuscleType.QUADRICEPS, MuscleType.GLUTEAL, MuscleType.HAMSTRING],
  OLYMPIC_LIFT: [MuscleType.UPPER_BACK, MuscleType.QUADRICEPS, MuscleType.FRONT_DELTOIDS, MuscleType.GLUTEAL],
  PLANK: [MuscleType.ABS],
  PLYO: [MuscleType.QUADRICEPS, MuscleType.CALVES],
  PULL_UP: [MuscleType.UPPER_BACK, MuscleType.BICEPS],
  PUSH_UP: [MuscleType.CHEST, MuscleType.TRICEPS, MuscleType.FRONT_DELTOIDS],
  ROW: [MuscleType.UPPER_BACK, MuscleType.BICEPS],
  RUN: [],
  RUN_INDOOR: [],
  SANDBAG: [MuscleType.UPPER_BACK, MuscleType.QUADRICEPS, MuscleType.FRONT_DELTOIDS],
  SHOULDER_PRESS: [MuscleType.FRONT_DELTOIDS, MuscleType.TRICEPS],
  SHOULDER_STABILITY: [MuscleType.FRONT_DELTOIDS, MuscleType.BACK_DELTOIDS],
  SHRUG: [MuscleType.TRAPEZIUS],
  SIT_UP: [MuscleType.ABS],
  SLED: [MuscleType.QUADRICEPS, MuscleType.GLUTEAL],
  SLEDGE_HAMMER: [MuscleType.BACK_DELTOIDS, MuscleType.ABS],
  SQUAT: [MuscleType.QUADRICEPS, MuscleType.GLUTEAL, MuscleType.HAMSTRING],
  STAIR_STEPPER: [],
  SUSPENSION: [MuscleType.CHEST, MuscleType.UPPER_BACK, MuscleType.ABS],
  TIRE: [MuscleType.QUADRICEPS, MuscleType.UPPER_BACK, MuscleType.FRONT_DELTOIDS],
  TOTAL_BODY: [MuscleType.CHEST, MuscleType.UPPER_BACK, MuscleType.QUADRICEPS, MuscleType.FRONT_DELTOIDS, MuscleType.ABS],
  TRICEPS_EXTENSION: [MuscleType.TRICEPS],
  WARM_UP: [],
};

export function categoryToMuscles(category: string): MuscleGroup[] {
  return CATEGORY_TO_MUSCLES[category.toUpperCase()] ?? [];
}

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
  for (const group of TRACKED_MUSCLE_GROUPS) {
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

/** 1.0 = trained today, fading toward 0 by RECENCY_FADE_DAYS. */
const RECENCY_FADE_DAYS = 14;

export function recencyIntensity(daysSince: number | null): number {
  if (daysSince == null) return 0;
  return Math.max(0, 1 - daysSince / RECENCY_FADE_DAYS);
}
