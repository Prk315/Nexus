import { getSupabaseClient, getUserId } from "../../../lib/supabase";
import type { BodyCompositionData, HistoryPoint } from "./data";
import type { RangeStat } from "./RangeBar";
import type { SegmentStat, SegmentalData } from "./SegmentalBody";
import type { Level } from "./BodyTypeGrid";

/**
 * Self-contained data access for the Body Composition module — queries
 * `protocol_body_metrics` directly (like `useExerciseSets` does for the Muscle
 * Map) so the module drops into any page without store wiring, and stays clear
 * of the biomarkers slice / `BodyMetric` type the rest of the app shares.
 *
 * The Vellafit scale reports measured values but not the population "standard"
 * bands the range meters draw — those aren't in the row or `bia_raw`, so the
 * low/high bands below are fixed reference constants. Every *value*, segment,
 * score and history point is live from the DB.
 */

// Rows come back with Postgres `numeric` as string, `integer` as number.
type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Only build a RangeStat when the measured value is present. */
function stat(label: string, value: number | null, low: number, high: number, unit?: string): RangeStat | null {
  return value == null ? null : { label, value, low, high, unit };
}

function seg(row: Record<string, unknown> | undefined, kind: "fat" | "muscle"): SegmentStat {
  const s = (row ?? {}) as Record<string, unknown>;
  return {
    value: num(s[`${kind}_kg`]) ?? 0,
    ratioPct: Math.round(num(s[`${kind}_pct`]) ?? 0),
  };
}

function segmental(segments: Record<string, unknown> | null, kind: "fat" | "muscle"): SegmentalData {
  const g = (segments ?? {}) as Record<string, Record<string, unknown>>;
  return {
    leftArm: seg(g.left_arm, kind),
    rightArm: seg(g.right_arm, kind),
    torso: seg(g.trunk, kind),
    leftLeg: seg(g.left_leg, kind),
    rightLeg: seg(g.right_leg, kind),
  };
}

/** Map the scale's `body_type` text onto the fat×muscle matrix cell. */
function bodyTypeToCell(bodyType: string | null): { fat: Level; muscle: Level } {
  const t = (bodyType ?? "").toLowerCase();
  const muscle: Level = t.includes("muscular") || t.includes("athletic") ? "high" : t.includes("low active") ? "low" : "standard";
  const fat: Level = t.includes("obese") || t.includes("overfat") ? "high" : t.includes("lean") || t.includes("fit") ? "low" : "standard";
  return { fat, muscle };
}

function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Average";
  return "Needs work";
}

/** Turn one scan row (+ all body-comp rows for history) into the view model.
 * Returns null when the row has no body-composition payload. */
function rowToBodyComposition(row: Row, history: Row[]): BodyCompositionData | null {
  const bodyFat = num(row.body_fat_pct);
  if (bodyFat == null && num(row.fat_mass_kg) == null) return null;

  const score = (row.health_score as number) ?? 0;
  const segments = (row.segments as Record<string, unknown>) ?? null;

  const advice: { label: string; value: string }[] = [];
  const push = (label: string, value: number | null, suffix = "") => {
    if (value != null) advice.push({ label, value: `${value}${suffix}` });
  };
  push("Health score", num(row.health_score));
  push("Body age", num(row.body_age));
  push("Visceral fat", num(row.visceral_fat));
  if (row.body_type) advice.push({ label: "Body type", value: String(row.body_type) });
  push("Muscle", num(row.muscle_pct), "%");
  push("Skeletal muscle quality", num(row.skeletal_muscle_quality));
  push("Body-cell mass", num(row.body_cell_mass_kg), " kg");
  push("Body water", num(row.body_water_pct), "%");

  return {
    weightKg: num(row.weight_kg) ?? 0,
    weightLow: 61,
    weightHigh: 82,
    score,
    scoreLabel: scoreLabel(score),
    composition: [
      { label: "Total body water", value: num(row.body_water_kg) ?? 0, low: 40.0, high: 48.8, unit: "kg", color: "var(--series-workout)" },
      { label: "Fat mass", value: num(row.fat_mass_kg) ?? 0, low: 8.1, high: 16.1, unit: "kg", color: "var(--series-nutrition)" },
      { label: "Protein mass", value: num(row.protein_kg) ?? 0, low: 10.7, high: 13.0, unit: "kg", color: "var(--macro-protein)" },
      { label: "Minerals", value: num(row.minerals_kg) ?? 0, low: 3.7, high: 4.5, unit: "kg", color: "var(--series-sleep)" },
    ],
    physical: [
      stat("BMI", num(row.bmi), 18.5, 25),
      stat("BMR", num(row.bmr_kcal), 1578, 1846, "kcal"),
      stat("Body fat", bodyFat, 11, 22, "%"),
      stat("Body water", num(row.body_water_pct), 50, 65, "%"),
      stat("Protein", num(row.protein_pct), 16, 20, "%"),
    ].filter((s): s is RangeStat => s != null),
    bones: [
      stat("Muscle mass", num(row.muscle_mass_kg), 51.5, 70.7, "kg"),
      stat("Skeletal muscle", num(row.skeletal_muscle_kg), 30.6, 37.4, "kg"),
      stat("Skeletal muscle %", num(row.skeletal_muscle_pct), 41.8, 51.1, "%"),
      stat("Bone mass", num(row.bone_mass_kg), 3.1, 3.8, "kg"),
    ].filter((s): s is RangeStat => s != null),
    fat: [
      stat("Body fat", bodyFat, 11, 22, "%"),
      stat("Subcutaneous fat", num(row.subcutaneous_fat_kg), 6.1, 11.9, "kg"),
      stat("Subcutaneous %", num(row.subcutaneous_fat_pct), 8.6, 16.7, "%"),
      stat("Visceral fat", num(row.visceral_fat), 1, 9),
      stat("Fat-free mass", num(row.fat_free_mass_kg), 52, 64.8, "kg"),
    ].filter((s): s is RangeStat => s != null),
    cellWater: {
      extracellularKg: num(row.extracellular_water_kg) ?? 0,
      intracellularKg: num(row.intracellular_water_kg) ?? 0,
      totalKg: num(row.body_water_kg) ?? 0,
      totalLow: 40,
      totalHigh: 49,
    },
    advice,
    bodyType: bodyTypeToCell(row.body_type as string | null),
    segmentalFat: segmental(segments, "fat"),
    segmentalMuscle: segmental(segments, "muscle"),
    history: history
      .map((h): HistoryPoint => ({
        date: String(h.date).slice(5).replace("-", "."),
        weightKg: num(h.weight_kg),
        skeletalMuscleKg: num(h.skeletal_muscle_kg),
        fatPct: num(h.body_fat_pct),
      }))
      .reverse(),
  };
}

/** Latest scan mapped to the view model, plus the history series behind it.
 * Returns null if not authenticated, on error, or when no scan exists yet. */
export async function fetchBodyComposition(): Promise<BodyCompositionData | null> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from("protocol_body_metrics")
      .select("*")
      .eq("user_id", getUserId())
      .not("body_fat_pct", "is", null)
      .order("date", { ascending: false });
    if (error || !data || data.length === 0) return null;
    return rowToBodyComposition(data[0] as Row, data as Row[]);
  } catch {
    return null;
  }
}
