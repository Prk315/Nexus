// Decode QN/Yolanda (CF597_GNLine / Vellafit) BLE frames into weight + segment
// impedances, and compute body composition via BIA — calibrated to the user's
// Vellafit readings. See project_vellafit_bridge memory for the protocol.
//
// Frame types on FFF4:
//   cf 00 00 [w_lo w_hi] 00 00 00 00 [flag] [xor]   → weight = w/100 kg
//   cf .. c0 ..                                       → "measurement done" marker
//   be [freq] + 5×(16-bit LE ÷10 Ω) + xor            → segment impedances:
//                                                        [RightArm, LeftArm, Trunk, RightLeg, LeftLeg]
//   df 02 [a][b] + payload                            → extra payload (not decoded yet)

export type Segments = { ra: number; la: number; trunk: number; rl: number; ll: number };

export type BodyComp = {
  weightKg: number;
  bmi: number;
  bmrKcal: number;
  bodyFatPct: number;
  fatMassKg: number;
  fatFreeMassKg: number;
  muscleMassKg: number;
  skeletalMuscleKg: number;
  bodyWaterPct: number;
  bodyWaterKg: number;
  boneMassKg: number;
};

// Single-user personal app. Height derived from Vellafit BMI 22.5 @ 73.15 kg.
export const PROFILE = { userId: "a33625c2-4dd2-44fa-b2e5-4d455eeac59d", age: 23, sex: "M" as const, heightCm: 180 };

// Calibration (v1) — anchored so the Aug-2 Vellafit reference (≈FFM 60.2 kg at the
// current leg impedance + weight) is reproduced. Refine after a synchronized
// morning measurement (Vellafit + Nexus Local at the same time).
const CAL = { ffmSlope: 0.518, ffmWeight: 0.231, ffmIntercept: -14.4 };

function bytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
const le16 = (b: number[], i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const r1 = (n: number) => Math.round(n * 10) / 10;

/// Decode the captured frames into a stable weight + the segment impedances (Ω).
export function decodeFrames(frames: { char: string; hex: string }[]): {
  weightKg: number | null;
  seg0: Segments | null;
  seg1: Segments | null;
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
        ra: le16(b, 2) / 10,
        la: le16(b, 4) / 10,
        trunk: le16(b, 6) / 10,
        rl: le16(b, 8) / 10,
        ll: le16(b, 10) / 10,
      };
      if (b[1] === 0x00) seg0 = seg;
      else if (b[1] === 0x01) seg1 = seg;
    }
  }

  // Stable weight = the most frequent non-zero reading (the scale settles there).
  let weightKg: number | null = null;
  if (weights.length) {
    const counts = new Map<number, number>();
    for (const w of weights) counts.set(w, (counts.get(w) ?? 0) + 1);
    weightKg = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }
  return { weightKg, seg0, seg1 };
}

/// Compute body composition from weight + segment impedances (freq0) + profile.
export function computeBodyComp(weightKg: number, seg0: Segments): BodyComp {
  const h = PROFILE.heightCm;
  const heightM = h / 100;
  const zLeg = (seg0.rl + seg0.ll) / 2; // foot-to-foot dominant path
  const idx = (h * h) / zLeg; // impedance index (height²/Z)

  const ffm = CAL.ffmSlope * idx + CAL.ffmWeight * weightKg + CAL.ffmIntercept;
  const fatMass = Math.max(0, weightKg - ffm);
  const fatPct = (fatMass / weightKg) * 100;
  const tbw = 0.732 * ffm; // standard FFM hydration
  const waterPct = (tbw / weightKg) * 100;
  const bone = 0.055 * ffm;
  const muscle = ffm - bone; // ≈ muscle mass
  const skeletal = 0.563 * ffm;
  const bmi = weightKg / (heightM * heightM);
  const bmr = Math.round(370 + 21.6 * ffm); // Katch-McArdle — matches Vellafit

  return {
    weightKg: r1(weightKg),
    bmi: r1(bmi),
    bmrKcal: bmr,
    bodyFatPct: r1(fatPct),
    fatMassKg: r1(fatMass),
    fatFreeMassKg: r1(ffm),
    muscleMassKg: r1(muscle),
    skeletalMuscleKg: r1(skeletal),
    bodyWaterPct: r1(waterPct),
    bodyWaterKg: r1(tbw),
    boneMassKg: r1(bone),
  };
}

/// Build the protocol_body_metrics row (today's date) from a decode + compute.
export function toBodyMetricsRow(bc: BodyComp, seg0: Segments | null, seg1: Segments | null, dateISO: string) {
  return {
    user_id: PROFILE.userId,
    date: dateISO,
    weight_kg: bc.weightKg,
    bmi: bc.bmi,
    bmr_kcal: bc.bmrKcal,
    body_fat_pct: bc.bodyFatPct,
    fat_mass_kg: bc.fatMassKg,
    fat_free_mass_kg: bc.fatFreeMassKg,
    muscle_mass_kg: bc.muscleMassKg,
    skeletal_muscle_kg: bc.skeletalMuscleKg,
    body_water_pct: bc.bodyWaterPct,
    body_water_kg: bc.bodyWaterKg,
    bone_mass_kg: bc.boneMassKg,
    bia_raw: { seg0, seg1, cal: CAL, profile: PROFILE },
    body_comp_estimated: true,
  };
}
