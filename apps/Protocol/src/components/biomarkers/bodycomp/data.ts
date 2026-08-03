import type { RangeStat } from "./RangeBar";
import type { SegmentalData } from "./SegmentalBody";
import type { Level } from "./BodyTypeGrid";

/**
 * Prop-driven data model for the body-composition report. Every field is what a
 * bio-impedance scale (e.g. the Vellafit bridge → `protocol_body_metrics`)
 * produces. UI is fully decoupled: the data layer another agent is wiring can
 * hand a `BodyCompositionData` in via the `data` prop; until then the module
 * renders `SAMPLE` so the layout is reviewable.
 */

export interface CompositionEntry {
  label: string;
  value: number;
  low: number;
  high: number;
  unit: string;
  color: string;
}

export interface HistoryPoint {
  date: string;
  weightKg: number | null;
  skeletalMuscleKg: number | null;
  fatPct: number | null;
}

export interface BodyCompositionData {
  weightKg: number;
  weightLow: number;
  weightHigh: number;
  score: number;
  scoreLabel: string;
  composition: CompositionEntry[];
  physical: RangeStat[];
  bones: RangeStat[];
  fat: RangeStat[];
  cellWater: {
    extracellularKg: number;
    intracellularKg: number;
    totalKg: number;
    totalLow: number;
    totalHigh: number;
  };
  advice: { label: string; value: string }[];
  bodyType: { fat: Level; muscle: Level };
  segmentalFat: SegmentalData;
  segmentalMuscle: SegmentalData;
  history: HistoryPoint[];
}

export const SAMPLE: BodyCompositionData = {
  weightKg: 73.15,
  weightLow: 61,
  weightHigh: 82,
  score: 77,
  scoreLabel: "Average",
  composition: [
    { label: "Total body water", value: 44.1, low: 40.0, high: 48.8, unit: "kg", color: "var(--series-workout)" },
    { label: "Fat mass", value: 12.9, low: 8.1, high: 16.1, unit: "kg", color: "var(--series-nutrition)" },
    { label: "Protein mass", value: 11.9, low: 10.7, high: 13.0, unit: "kg", color: "var(--macro-protein)" },
    { label: "Minerals", value: 4.2, low: 3.7, high: 4.5, unit: "kg", color: "var(--series-sleep)" },
  ],
  physical: [
    { label: "BMI", value: 22.5, low: 18.5, high: 25 },
    { label: "Pulse", value: 62, low: 55, high: 100, unit: "bpm" },
    { label: "BMR", value: 1670, low: 1578, high: 1846, unit: "kcal" },
    { label: "Adiposition", value: 102, low: 90, high: 110, unit: "%" },
    { label: "Protein ratio", value: 16.2, low: 14.6, high: 17.7, unit: "%" },
    { label: "Waist-hip ratio", value: 0.82, low: 0.8, high: 0.9 },
  ],
  bones: [
    { label: "Muscle mass", value: 56, low: 51.5, high: 70.7, unit: "kg" },
    { label: "Skeletal muscle", value: 33.9, low: 30.6, high: 37.4, unit: "kg" },
    { label: "Skeletal muscle %", value: 46.3, low: 41.8, high: 51.1, unit: "%" },
    { label: "Bone mass", value: 3.3, low: 3.1, high: 3.8, unit: "kg" },
  ],
  fat: [
    { label: "Body fat", value: 17.6, low: 11, high: 22, unit: "%" },
    { label: "Subcutaneous fat", value: 11.2, low: 6.1, high: 11.9, unit: "kg" },
    { label: "Subcutaneous %", value: 15.3, low: 8.6, high: 16.7, unit: "%" },
    { label: "Visceral fat", value: 6, low: 1, high: 9 },
    { label: "Fat-free mass", value: 60.2, low: 52, high: 64.8, unit: "kg" },
  ],
  cellWater: {
    extracellularKg: 16.4,
    intracellularKg: 27.6,
    totalKg: 44.1,
    totalLow: 40,
    totalHigh: 49,
  },
  advice: [
    { label: "Ideal weight", value: "71.3 kg" },
    { label: "Weight control", value: "−1.9 kg" },
    { label: "Fat control", value: "−2.2 kg" },
    { label: "Muscle control", value: "+0.3 kg" },
    { label: "Health evaluation", value: "Fair" },
    { label: "Body age", value: "18" },
    { label: "Recommended intake", value: "2171 kcal" },
    { label: "Fat level", value: "Standard" },
  ],
  bodyType: { fat: "standard", muscle: "standard" },
  segmentalFat: {
    leftArm: { value: 0.9, ratioPct: 128 },
    rightArm: { value: 0.8, ratioPct: 114 },
    torso: { value: 6.5, ratioPct: 141 },
    leftLeg: { value: 1.7, ratioPct: 89 },
    rightLeg: { value: 1.6, ratioPct: 84 },
  },
  segmentalMuscle: {
    leftArm: { value: 3.0, ratioPct: 91 },
    rightArm: { value: 3.2, ratioPct: 97 },
    torso: { value: 26.5, ratioPct: 102 },
    leftLeg: { value: 9.4, ratioPct: 104 },
    rightLeg: { value: 10.0, ratioPct: 111 },
  },
  history: [
    { date: "03.29", weightKg: 79.25, skeletalMuscleKg: null, fatPct: null },
    { date: "03.30", weightKg: 78.1, skeletalMuscleKg: 38.1, fatPct: 14.5 },
    { date: "03.31", weightKg: 78.25, skeletalMuscleKg: 35.6, fatPct: 19.5 },
    { date: "04.01", weightKg: 77.25, skeletalMuscleKg: 35.4, fatPct: 19.0 },
    { date: "04.01", weightKg: 77.25, skeletalMuscleKg: 35.4, fatPct: 19.0 },
    { date: "05.04", weightKg: 77.7, skeletalMuscleKg: 35.1, fatPct: 20.0 },
    { date: "08.02", weightKg: 73.15, skeletalMuscleKg: 33.9, fatPct: 17.6 },
    { date: "08.02", weightKg: 73.15, skeletalMuscleKg: 33.9, fatPct: 17.6 },
  ],
};
