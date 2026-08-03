// Decode QN/Yolanda (CF597_GNLine / Vellafit) BLE frames into weight + segment
// impedances, and compute full body composition via BIA — calibrated to a
// synchronized Vellafit measurement. See project_vellafit_bridge memory.
//
// Frame types on FFF4:
//   cf 00 00 [w_lo w_hi] 00 00 00 00 [flag] [xor]   → weight = w/100 kg
//   cf .. c0 ..                                       → "measurement done" marker
//   be [freq] + 5×(16-bit LE ÷10 Ω) + xor            → segment impedances:
//                                                        [RightArm, LeftArm, Trunk, RightLeg, LeftLeg]
//   df 02 [a][b] + payload                            → raw impedance/reactance (not needed; per-limb
//                                                        values are computed from the be impedances)

export type Segments = { ra: number; la: number; trunk: number; rl: number; ll: number };

export type SegmentComp = { muscle_kg: number; fat_kg: number; impedance_ohm: number };
export type SegmentMap = {
  left_arm: SegmentComp; right_arm: SegmentComp; trunk: SegmentComp;
  left_leg: SegmentComp; right_leg: SegmentComp;
};

export type BodyComp = {
  weightKg: number; bmi: number; bmrKcal: number;
  bodyFatPct: number; fatMassKg: number; subcutaneousFatKg: number; subcutaneousFatPct: number;
  fatFreeMassKg: number; muscleMassKg: number; musclePct: number;
  skeletalMuscleKg: number; skeletalMusclePct: number;
  bodyWaterKg: number; bodyWaterPct: number; intracellularWaterKg: number; extracellularWaterKg: number;
  proteinKg: number; proteinPct: number; mineralsKg: number; boneMassKg: number; bodyCellMassKg: number;
  segments: SegmentMap;
};

// Single-user personal app. Height derived from Vellafit BMI @ known weight.
export const PROFILE = { userId: "a33625c2-4dd2-44fa-b2e5-4d455eeac59d", age: 23, sex: "M" as const, heightCm: 180 };

// Calibration — anchored to the 2026-08-03 synchronized Vellafit measurement
// (73.30 kg). Whole-body fractions and per-limb constants come from that reading.
// Refine ffmIntercept / fractions after future synchronized weigh-ins.
const CAL = {
  ffmSlope: 0.518, ffmWeight: 0.231, ffmIntercept: -13.35,
  hydration: 0.732,       // TBW / FFM
  icwFrac: 0.626,         // ICW / TBW (ECW = TBW − ICW)
  boneFrac: 0.054, mineralFrac: 0.0686, muscleFrac: 0.931,
  skeletalFrac: 0.565, bcmFrac: 0.660, subcutFrac: 0.859,
  // per-limb muscle uses K/Z (K = muscle_kg × Z from the calibration measurement)
  limbMuscleK: { right_arm: 1079.4, left_arm: 1041.0, trunk: 694.0, right_leg: 2892.0, left_leg: 2846.0 },
  // per-limb fat = fraction of total fat mass (from the calibration measurement)
  limbFatFrac: { right_arm: 0.0661, left_arm: 0.0661, trunk: 0.5041, right_leg: 0.1240, left_leg: 0.1322 },
};

function bytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
const le16 = (b: number[], i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const r1 = (n: number) => Math.round(n * 10) / 10;

/// Decode the captured frames into a stable weight + segment impedances (Ω).
export function decodeFrames(frames: { char: string; hex: string }[]): {
  weightKg: number | null; seg0: Segments | null; seg1: Segments | null;
} {
  const weights: number[] = [];
  let seg0: Segments | null = null;
  let seg1: Segments | null = null;
  for (const f of frames) {
    const b = bytes(f.hex);
    if (b[0] === 0xcf) {
      if (b[2] === 0xc0) continue; // done-marker, not a weight
      const w = le16(b, 3) / 100;
      if (w > 20 && w < 300) weights.push(w);
    } else if (b[0] === 0xbe) {
      const seg: Segments = {
        ra: le16(b, 2) / 10, la: le16(b, 4) / 10, trunk: le16(b, 6) / 10,
        rl: le16(b, 8) / 10, ll: le16(b, 10) / 10,
      };
      if (b[1] === 0x00) seg0 = seg;
      else if (b[1] === 0x01) seg1 = seg;
    }
  }
  let weightKg: number | null = null;
  if (weights.length) {
    const counts = new Map<number, number>();
    for (const w of weights) counts.set(w, (counts.get(w) ?? 0) + 1);
    weightKg = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }
  return { weightKg, seg0, seg1 };
}

function segmentComp(seg0: Segments, fatMass: number): SegmentMap {
  const z = { right_arm: seg0.ra, left_arm: seg0.la, trunk: seg0.trunk, right_leg: seg0.rl, left_leg: seg0.ll };
  const build = (k: keyof SegmentMap): SegmentComp => ({
    muscle_kg: r1(CAL.limbMuscleK[k] / z[k]),
    fat_kg: r1(CAL.limbFatFrac[k] * fatMass),
    impedance_ohm: z[k],
  });
  return {
    left_arm: build("left_arm"), right_arm: build("right_arm"), trunk: build("trunk"),
    left_leg: build("left_leg"), right_leg: build("right_leg"),
  };
}

/// Compute full body composition from weight + segment impedances (freq0) + profile.
export function computeBodyComp(weightKg: number, seg0: Segments): BodyComp {
  const h = PROFILE.heightCm;
  const heightM = h / 100;
  const zLeg = (seg0.rl + seg0.ll) / 2;
  const idx = (h * h) / zLeg;

  const ffm = CAL.ffmSlope * idx + CAL.ffmWeight * weightKg + CAL.ffmIntercept;
  const fatMass = Math.max(0, weightKg - ffm);
  const tbw = CAL.hydration * ffm;
  const icw = CAL.icwFrac * tbw;
  const minerals = CAL.mineralFrac * ffm;
  const protein = ffm - tbw - minerals;
  const muscle = CAL.muscleFrac * ffm;
  const skeletal = CAL.skeletalFrac * ffm;
  const subcut = CAL.subcutFrac * fatMass;

  return {
    weightKg: r1(weightKg),
    bmi: r1(weightKg / (heightM * heightM)),
    bmrKcal: Math.round(370 + 21.6 * ffm), // Katch-McArdle — matches Vellafit
    bodyFatPct: r1((fatMass / weightKg) * 100),
    fatMassKg: r1(fatMass),
    subcutaneousFatKg: r1(subcut),
    subcutaneousFatPct: r1((subcut / weightKg) * 100),
    fatFreeMassKg: r1(ffm),
    muscleMassKg: r1(muscle),
    musclePct: r1((muscle / weightKg) * 100),
    skeletalMuscleKg: r1(skeletal),
    skeletalMusclePct: r1((skeletal / weightKg) * 100),
    bodyWaterKg: r1(tbw),
    bodyWaterPct: r1((tbw / weightKg) * 100),
    intracellularWaterKg: r1(icw),
    extracellularWaterKg: r1(tbw - icw),
    proteinKg: r1(protein),
    proteinPct: r1((protein / weightKg) * 100),
    mineralsKg: r1(minerals),
    boneMassKg: r1(CAL.boneFrac * ffm),
    bodyCellMassKg: r1(CAL.bcmFrac * ffm),
    segments: segmentComp(seg0, fatMass),
  };
}

/// Build the protocol_body_metrics row (today's date). `rawFrames` (all hex,
/// incl. the un-decoded df frames) are embedded so nothing is lost. Proprietary
/// Vellafit metrics (visceral fat, body age, health score, SMI quality) aren't
/// computable from impedance — left null unless a Vellafit reading fills them.
export function toBodyMetricsRow(
  bc: BodyComp, seg0: Segments | null, seg1: Segments | null, dateISO: string, rawFrames: string[] = [],
) {
  return {
    user_id: PROFILE.userId,
    date: dateISO,
    weight_kg: bc.weightKg,
    bmi: bc.bmi,
    bmr_kcal: bc.bmrKcal,
    body_fat_pct: bc.bodyFatPct,
    fat_mass_kg: bc.fatMassKg,
    subcutaneous_fat_kg: bc.subcutaneousFatKg,
    subcutaneous_fat_pct: bc.subcutaneousFatPct,
    fat_free_mass_kg: bc.fatFreeMassKg,
    muscle_mass_kg: bc.muscleMassKg,
    muscle_pct: bc.musclePct,
    skeletal_muscle_kg: bc.skeletalMuscleKg,
    skeletal_muscle_pct: bc.skeletalMusclePct,
    body_water_kg: bc.bodyWaterKg,
    body_water_pct: bc.bodyWaterPct,
    intracellular_water_kg: bc.intracellularWaterKg,
    extracellular_water_kg: bc.extracellularWaterKg,
    protein_kg: bc.proteinKg,
    protein_pct: bc.proteinPct,
    minerals_kg: bc.mineralsKg,
    bone_mass_kg: bc.boneMassKg,
    body_cell_mass_kg: bc.bodyCellMassKg,
    segments: bc.segments,
    bia_raw: { seg0, seg1, cal: CAL, profile: PROFILE, raw_frames: rawFrames },
    body_comp_estimated: true,
  };
}
