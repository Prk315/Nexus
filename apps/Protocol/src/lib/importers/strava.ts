import { parseCSV } from "../csv";
import type { CreateRunningSession, CreateWorkoutSession } from "../../store/types";

export interface StravaImportResult {
  runningSessions: Array<CreateRunningSession & { id: string; completed: boolean }>;
  workoutSessions: Array<CreateWorkoutSession & { id: string; completed: boolean }>;
  skipped: number;
  warnings: string[];
}

const RUN_TYPES = new Set([
  "Run", "Trail Run", "VirtualRun", "Treadmill", "Indoor Run",
  "TrailRun", "VirtualRide" /* some users log virtual runs as rides */,
  "Løb", // Danish
]);

// Column-name aliases. Strava localises the CSV headers to the account's
// language, so we match English AND the Danish variants (her export). Column
// names also repeat (display vs raw value) — parseCSV keeps the last, which is
// the raw numeric one, which is what we want.
const COLS = {
  id:        ["Activity ID", "id", "Aktivitets-id"],
  type:      ["Activity Type", "type", "Aktivitetstype"],
  name:      ["Activity Name", "Name", "name", "Aktivitetsnavn"],
  date:      ["Activity Date", "Date", "date", "Aktivitetsdato"],
  distance:  ["Distance", "distance"],
  movingTime:["Moving Time", "moving_time", "Tid i bevægelse"],
  avgSpeed:  ["Average Speed", "average_speed", "Gennemsnitlig hastighed"],
  avgHr:     ["Average Heart Rate", "average_heart_rate", "Gennemsnitlig puls"],
  maxHr:     ["Max Heart Rate", "max_heart_rate", "Maks. puls"],
  elevGain:  ["Elevation Gain", "elevation_gain", "Samlet stigning"],
  cadence:   ["Average Cadence", "average_cadence", "Gennemsnitlig kadence"],
  calories:  ["Calories", "calories", "Kalorier"],
};

/** First non-empty value among the given header aliases. */
function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v !== "") return v;
  }
  return "";
}

/** parseFloat that also accepts a European decimal comma ("2,84" → 2.84). */
function num(v: string): number {
  if (!v) return NaN;
  const s = /^-?\d+,\d+$/.test(v.trim()) ? v.trim().replace(",", ".") : v.trim();
  return parseFloat(s);
}

/** Deterministic UUID from a seed (cyrb128 hash → uuid shape). Used to give a
 * Strava activity a STABLE id derived from its unique Activity ID, so that
 * re-importing the same export upserts the existing row instead of creating a
 * duplicate. Falls back to a random id when the Activity ID is missing. */
function stableUuid(seed: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hx = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const h = hx(h1) + hx(h2) + hx(h3) + hx(h4);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sessionId(row: Record<string, string>): string {
  const sid = pick(row, COLS.id);
  return sid ? stableUuid(`strava:${sid}`) : crypto.randomUUID();
}

export function parseStravaActivities(text: string): StravaImportResult {
  const rows = parseCSV(text);
  const result: StravaImportResult = {
    runningSessions: [], workoutSessions: [], skipped: 0, warnings: [],
  };

  for (const row of rows) {
    const activityType = pick(row, COLS.type);
    const name         = pick(row, COLS.name) || "Activity";
    const date         = parseStravaDate(pick(row, COLS.date));

    if (!date) { result.skipped++; continue; }

    const distanceRaw  = num(pick(row, COLS.distance));
    const movingTimeS  = num(pick(row, COLS.movingTime));
    const avgSpeedRaw  = num(pick(row, COLS.avgSpeed));
    const avgHrRaw     = num(pick(row, COLS.avgHr));
    const maxHrRaw     = num(pick(row, COLS.maxHr));
    const elevGain     = num(pick(row, COLS.elevGain));
    const cadenceRaw   = num(pick(row, COLS.cadence));
    const caloriesRaw  = num(pick(row, COLS.calories));

    // Strava bulk export distances are in metres; individual values can be km
    const distance = isNaN(distanceRaw) ? 0 : distanceRaw;
    const distanceKm = distance > 200 ? distance / 1000 : distance;

    // Pace: prefer time/distance, fall back to speed
    let paceSPerKm: number | null = null;
    if (distanceKm > 0 && movingTimeS > 0) {
      paceSPerKm = Math.round(movingTimeS / distanceKm);
    } else if (avgSpeedRaw > 0) {
      // avgSpeed in m/s → s/km = 1000 / speed
      paceSPerKm = Math.round(1000 / avgSpeedRaw);
    }

    const heartRate    = isNaN(avgHrRaw)   ? null : Math.round(avgHrRaw);
    const heartRateMax = isNaN(maxHrRaw)   ? null : Math.round(maxHrRaw);
    const elevGainM    = isNaN(elevGain)   ? null : Math.round(elevGain);
    const cadence      = isNaN(cadenceRaw) ? null : Math.round(cadenceRaw);
    const calories     = isNaN(caloriesRaw) ? null : Math.round(caloriesRaw);
    const durationMin  = movingTimeS > 0   ? Math.round(movingTimeS / 60) : null;
    const notes = `Strava: ${name}${elevGainM && elevGainM > 0 ? ` (+${elevGainM}m)` : ""}`;

    const isRun = RUN_TYPES.has(activityType) || /løb|run|jog/i.test(activityType);

    if (isRun) {
      result.runningSessions.push({
        id: sessionId(row),
        date,
        actual_km:         distanceKm > 0 ? Math.round(distanceKm * 100) / 100 : null,
        planned_km:        null,
        avg_pace_s_per_km: paceSPerKm,
        heart_rate_avg:    heartRate,
        heart_rate_max:    heartRateMax,
        elevation_gain_m:  elevGainM,
        cadence_avg:       cadence,
        calories,
        notes,
        completed: true,
      });
      continue;
    }

    if (activityType !== "") {
      result.workoutSessions.push({
        id: sessionId(row),
        name,
        scheduled_date: date,
        plan_id: null,
        duration_min:   durationMin,
        calories_burned: calories,
        avg_heart_rate:  heartRate,
        notes: `Strava (${activityType})${elevGainM && elevGainM > 0 ? ` — ${notes.split(": ")[1]}` : ""}`,
        completed: true,
      });
    } else {
      result.skipped++;
    }
  }

  return result;
}

// Danish month abbreviations (first 3 letters are unique per month).
const DA_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};

function parseStravaDate(raw: string): string | null {
  if (!raw) return null;
  // ISO / English-first: "2026-08-04…"
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Danish: "1. aug. 2026, 18.30.48" or "29. maj 2025, …"
  const da = raw.match(/^(\d{1,2})\.\s*([A-Za-zæøåÆØÅ]+)\.?\s+(\d{4})/);
  if (da) {
    const mon = DA_MONTHS[da[2].toLowerCase().slice(0, 3)];
    if (mon) return `${da[3]}-${String(mon).padStart(2, "0")}-${da[1].padStart(2, "0")}`;
  }
  // Fallback: let JS try (English month names like "Aug 4, 2026").
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return null;
}
