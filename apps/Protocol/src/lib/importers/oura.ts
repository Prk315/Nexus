import { parseCSV } from "../csv";
import type { CreateBodyMetric, CreateSleepEntry } from "../../store/types";

export interface OuraImportResult {
  sleepEntries: Array<CreateSleepEntry & { id: string }>;
  bodyMetrics: Array<CreateBodyMetric & { id: string }>;
  warnings: string[];
}

/** Detect which Oura export CSV this is by inspecting its headers. */
export function detectOuraType(text: string): "sleep" | "readiness" | "activity" | "unknown" {
  const firstLine = text.split("\n")[0].toLowerCase();
  if (firstLine.includes("total sleep") || firstLine.includes("deep sleep") || firstLine.includes("rem sleep")) return "sleep";
  if (firstLine.includes("readiness") || firstLine.includes("recovery index") || firstLine.includes("sleep balance")) return "readiness";
  if (firstLine.includes("steps") || firstLine.includes("active calories")) return "activity";
  return "unknown";
}

export function parseOuraCSV(text: string): OuraImportResult {
  const type = detectOuraType(text);
  if (type === "sleep") return parseOuraSleep(text);
  if (type === "readiness") return parseOuraReadiness(text);
  return { sleepEntries: [], bodyMetrics: [], warnings: [`Unrecognised Oura CSV format — expected sleep.csv or readiness.csv`] };
}

// ── Sleep export ─────────────────────────────────────────────────────────────

function parseOuraSleep(text: string): OuraImportResult {
  const rows = parseCSV(text);
  const result: OuraImportResult = { sleepEntries: [], bodyMetrics: [], warnings: [] };

  for (const row of rows) {
    const date = normalizeDate(field(row, "date"));
    if (!date) { result.warnings.push("Skipped row with no parseable date"); continue; }

    // Skip rest/nap entries if type column is present
    const type = field(row, "type").toLowerCase();
    if (type && type !== "long_sleep" && type !== "" && type !== "sleep") continue;

    const totalSleepS = num(field(row, "total sleep duration") || field(row, "total_sleep_duration"));
    const remS        = num(field(row, "rem sleep duration")   || field(row, "rem_sleep_duration"));
    const deepS       = num(field(row, "deep sleep duration")  || field(row, "deep_sleep_duration"));
    const timeInBedS  = num(field(row, "time in bed")          || field(row, "time_in_bed"));

    // Quality: prefer explicit score (0-100 → 0-10), fall back to efficiency
    let quality = 7.0;
    const scoreRaw = field(row, "sleep score") || field(row, "score");
    if (scoreRaw && !isNaN(parseFloat(scoreRaw))) {
      quality = Math.min(10, Math.max(0, parseFloat(scoreRaw) / 10));
    } else if (totalSleepS > 0 && timeInBedS > 0) {
      quality = Math.min(10, (totalSleepS / timeInBedS) * 10);
    }

    const lightS     = num(field(row, "light sleep duration") || field(row, "light_sleep_duration"));
    const awakeS     = num(field(row, "awake time")           || field(row, "awake_time"));
    const respRate   = num(field(row, "respiratory rate")     || field(row, "average_breath"));
    const tempDev    = num(field(row, "temperature deviation") || field(row, "skin_temp_deviation"));
    const bedStart   = field(row, "bedtime start") || field(row, "bedtime_start") || null;
    const bedEnd     = field(row, "bedtime end")   || field(row, "bedtime_end")   || null;

    if (totalSleepS > 0) {
      result.sleepEntries.push({
        id: crypto.randomUUID(),
        date,
        duration_min: Math.round(totalSleepS / 60),
        quality_score: Math.round(quality * 10) / 10,
        deep_sleep_min:  deepS  > 0 ? Math.round(deepS  / 60) : null,
        rem_sleep_min:   remS   > 0 ? Math.round(remS   / 60) : null,
        light_sleep_min: lightS > 0 ? Math.round(lightS / 60) : null,
        awake_time_min:  awakeS > 0 ? Math.round(awakeS / 60) : null,
        respiratory_rate: !isNaN(respRate) ? Math.round(respRate * 10) / 10 : null,
        temperature_deviation: !isNaN(tempDev) ? Math.round(tempDev * 100) / 100 : null,
        bedtime_start: bedStart || null,
        bedtime_end:   bedEnd   || null,
        notes: "Oura Ring import",
      });
    }

    // HRV + resting HR live in the sleep CSV too
    const hrv       = num(field(row, "average hrv") || field(row, "average_hrv"));
    const restingHr = num(field(row, "average resting heart rate") || field(row, "average_heart_rate"));
    if (!isNaN(hrv) || !isNaN(restingHr)) {
      result.bodyMetrics.push({
        id: crypto.randomUUID(),
        date,
        hrv_ms:               isNaN(hrv) ? null : Math.round(hrv),
        resting_hr_bpm:       isNaN(restingHr) ? null : Math.round(restingHr),
        temperature_deviation: !isNaN(tempDev) ? Math.round(tempDev * 100) / 100 : null,
        weight_kg: null,
        spo2_pct:  null,
        notes: "Oura Ring import",
      });
    }
  }

  return result;
}

// ── Readiness export ──────────────────────────────────────────────────────────

function parseOuraReadiness(text: string): OuraImportResult {
  const rows = parseCSV(text);
  const result: OuraImportResult = { sleepEntries: [], bodyMetrics: [], warnings: [] };

  for (const row of rows) {
    const date = normalizeDate(field(row, "date"));
    if (!date) continue;

    const hrv           = num(field(row, "hrv balance") || field(row, "average hrv") || field(row, "hrv"));
    const restingHr     = num(field(row, "resting heart rate"));
    const readiness     = num(field(row, "readiness score") || field(row, "score"));
    const tempDev       = num(field(row, "temperature deviation") || field(row, "skin_temp_deviation"));
    const recoveryIndex = num(field(row, "recovery index"));

    if (!isNaN(hrv) || !isNaN(restingHr) || !isNaN(readiness)) {
      result.bodyMetrics.push({
        id: crypto.randomUUID(),
        date,
        hrv_ms:               isNaN(hrv)           ? null : Math.round(hrv),
        resting_hr_bpm:       isNaN(restingHr)     ? null : Math.round(restingHr),
        readiness_score:      isNaN(readiness)      ? null : Math.round(readiness),
        temperature_deviation: !isNaN(tempDev)      ? Math.round(tempDev * 100) / 100 : null,
        recovery_index:       isNaN(recoveryIndex)  ? null : Math.round(recoveryIndex * 10) / 10,
        weight_kg: null,
        spo2_pct:  null,
        notes: "Oura Ring readiness import",
      });
    }
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Case-insensitive, partial-key field lookup. */
function field(row: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().includes(lower)) return v;
  }
  return "";
}

/** Attempt to parse a number; returns NaN on failure. */
function num(s: string): number {
  return parseFloat(s);
}

/** Normalise Oura date strings to YYYY-MM-DD. */
function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return null;
}
