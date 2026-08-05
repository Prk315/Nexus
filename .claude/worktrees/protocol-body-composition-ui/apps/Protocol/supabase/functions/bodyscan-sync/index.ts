// Supabase Edge Function: bodyscan-sync
//
// Auto-promotes raw Vellafit BLE captures (nexus_ble_captures) into the
// computed body-composition row on protocol_body_metrics — the server-side
// replacement for tapping "Save to Protocol" in the Nexus Local app.
//
// CLOBBER-SAFE by construction: it only ever writes body-composition columns
// (weight, fat, muscle, water, segments, bia_raw, …). It never touches
// hrv/sleep/stress/readiness or `notes`, so it cannot wipe the Oura/Garmin
// fields the way the shared-row writers do today.
//
// Decode + BIA math are a straight port of apps/NexusLocal/src/lib/bodyScan.ts
// (v0.9.0 calibration). Keep the CAL block in sync with that file after any
// re-calibration.
//
// Idempotency: processed captures are marked via nexus_ble_captures.processed_at
// (added by migration). Re-running is safe; already-processed captures are skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Profile + calibration (mirror bodyScan.ts) ───────────────────────────────
const PROFILE = { userId: "a33625c2-4dd2-44fa-b2e5-4d455eeac59d", heightCm: 180 };
const CAL = {
  ffmSlope: 0.518, ffmWeight: 0.231, ffmIntercept: -13.35,
  hydration: 0.732, icwFrac: 0.626,
  boneFrac: 0.054, mineralFrac: 0.0686, muscleFrac: 0.931,
  skeletalFrac: 0.565, bcmFrac: 0.660, subcutFrac: 0.859,
  limbMuscleK: { right_arm: 1079.4, left_arm: 1041.0, trunk: 694.0, right_leg: 2892.0, left_leg: 2846.0 },
  limbFatFrac: { right_arm: 0.0661, left_arm: 0.0661, trunk: 0.5041, right_leg: 0.1240, left_leg: 0.1322 },
};

type Segments = { ra: number; la: number; trunk: number; rl: number; ll: number };

const bytes = (hex: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};
const le16 = (b: number[], i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const r1 = (n: number) => Math.round(n * 10) / 10;

function decodeFrames(frames: { char?: string; hex: string }[]) {
  const weights: number[] = [];
  let seg0: Segments | null = null;
  let seg1: Segments | null = null;
  for (const f of frames) {
    const b = bytes(f.hex);
    if (b[0] === 0xcf) {
      if (b[2] === 0xc0) continue;
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

function segmentComp(seg0: Segments, fatMass: number) {
  const z = { right_arm: seg0.ra, left_arm: seg0.la, trunk: seg0.trunk, right_leg: seg0.rl, left_leg: seg0.ll };
  const build = (k: keyof typeof CAL.limbMuscleK) => ({
    muscle_kg: r1(CAL.limbMuscleK[k] / z[k]),
    fat_kg: r1(CAL.limbFatFrac[k] * fatMass),
    impedance_ohm: z[k],
  });
  return {
    left_arm: build("left_arm"), right_arm: build("right_arm"), trunk: build("trunk"),
    left_leg: build("left_leg"), right_leg: build("right_leg"),
  };
}

function computeBodyComp(weightKg: number, seg0: Segments) {
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
    weight_kg: r1(weightKg),
    bmi: r1(weightKg / (heightM * heightM)),
    bmr_kcal: Math.round(370 + 21.6 * ffm),
    body_fat_pct: r1((fatMass / weightKg) * 100),
    fat_mass_kg: r1(fatMass),
    subcutaneous_fat_kg: r1(subcut),
    subcutaneous_fat_pct: r1((subcut / weightKg) * 100),
    fat_free_mass_kg: r1(ffm),
    muscle_mass_kg: r1(muscle),
    muscle_pct: r1((muscle / weightKg) * 100),
    skeletal_muscle_kg: r1(skeletal),
    skeletal_muscle_pct: r1((skeletal / weightKg) * 100),
    body_water_kg: r1(tbw),
    body_water_pct: r1((tbw / weightKg) * 100),
    intracellular_water_kg: r1(icw),
    extracellular_water_kg: r1(tbw - icw),
    protein_kg: r1(protein),
    protein_pct: r1((protein / weightKg) * 100),
    minerals_kg: r1(minerals),
    bone_mass_kg: r1(CAL.boneFrac * ffm),
    body_cell_mass_kg: r1(CAL.bcmFrac * ffm),
    segments: segmentComp(seg0, fatMass),
  };
}

// Capture's local calendar day (Europe/Copenhagen) — matches the app's todayLocal().
function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Unprocessed captures, oldest first so same-day scans land in order.
  const { data: captures, error: capErr } = await supabase
    .from("nexus_ble_captures")
    .select("id, created_at, snapshot")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (capErr) return json({ error: capErr.message }, 500);

  const results: unknown[] = [];
  for (const cap of captures ?? []) {
    const frames = (cap.snapshot?.frames ?? []) as { char?: string; hex: string }[];
    const { weightKg, seg0, seg1 } = decodeFrames(frames);

    // No decodable body-comp payload (weight-only capture, partial scan): mark
    // processed so it isn't retried forever, but write nothing.
    if (!weightKg || !seg0) {
      await supabase.from("nexus_ble_captures").update({ processed_at: new Date().toISOString() }).eq("id", cap.id);
      results.push({ id: cap.id, skipped: "no body-comp frames" });
      continue;
    }

    const date = localDate(cap.created_at);
    const bc = computeBodyComp(weightKg, seg0);
    // ONLY body-composition columns — never notes / hrv / sleep / stress.
    const fields = {
      ...bc,
      bia_raw: { seg0, seg1, cal: CAL, profile: PROFILE, raw_frames: frames.map((f) => f.hex) },
      body_comp_estimated: false,
    };

    const { data: existing } = await supabase
      .from("protocol_body_metrics")
      .select("id")
      .eq("user_id", PROFILE.userId)
      .eq("date", date)
      .order("created_at", { ascending: true })
      .limit(1);

    let writeErr: string | null = null;
    if (existing && existing.length) {
      const { error } = await supabase.from("protocol_body_metrics").update(fields).eq("id", existing[0].id);
      writeErr = error?.message ?? null;
    } else {
      const { error } = await supabase
        .from("protocol_body_metrics")
        .insert({ id: crypto.randomUUID(), user_id: PROFILE.userId, date, ...fields });
      writeErr = error?.message ?? null;
    }

    if (!writeErr) {
      await supabase.from("nexus_ble_captures").update({ processed_at: new Date().toISOString() }).eq("id", cap.id);
    }
    results.push({ id: cap.id, date, weight_kg: bc.weight_kg, wrote: !writeErr, error: writeErr });
  }

  return json({ processed: results.length, results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
