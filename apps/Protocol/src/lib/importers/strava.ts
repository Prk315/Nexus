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
]);

const WORKOUT_TYPES = new Set([
  "WeightTraining", "Workout", "CrossFit", "Elliptical",
  "StairStepper", "Yoga", "Pilates", "Rowing", "Swim", "Swimming",
  "Hike", "Walk", "Velomobile", "Badminton", "Tennis", "Squash",
  "Handball", "Racquetball", "Skateboard", "Surfing", "Snowboard",
  "AlpineSki", "NordicSki", "Snowshoe",
]);

export function parseStravaActivities(text: string): StravaImportResult {
  const rows = parseCSV(text);
  const result: StravaImportResult = {
    runningSessions: [], workoutSessions: [], skipped: 0, warnings: [],
  };

  for (const row of rows) {
    const activityType = row["Activity Type"] ?? row["type"] ?? "";
    const name         = row["Activity Name"] ?? row["Name"] ?? row["name"] ?? "Activity";
    const dateRaw      = row["Activity Date"] ?? row["Date"] ?? row["date"] ?? "";
    const date         = parseStravaDate(dateRaw);

    if (!date) { result.skipped++; continue; }

    const distanceRaw  = parseFloat(row["Distance"]           ?? row["distance"]            ?? "0");
    const movingTimeS  = parseFloat(row["Moving Time"]         ?? row["moving_time"]         ?? "0");
    const avgSpeedRaw  = parseFloat(row["Average Speed"]       ?? row["average_speed"]       ?? "0");
    const avgHrRaw     = parseFloat(row["Average Heart Rate"]  ?? row["average_heart_rate"]  ?? "");
    const maxHrRaw     = parseFloat(row["Max Heart Rate"]      ?? row["max_heart_rate"]      ?? "");
    const elevGain     = parseFloat(row["Elevation Gain"]      ?? row["elevation_gain"]      ?? "");
    const cadenceRaw   = parseFloat(row["Average Cadence"]     ?? row["average_cadence"]     ?? "");
    const caloriesRaw  = parseFloat(row["Calories"]            ?? row["calories"]            ?? "");

    // Strava bulk export distances are in metres; individual values can be km
    const distanceKm = distanceRaw > 200 ? distanceRaw / 1000 : distanceRaw;

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

    const isRun =
      RUN_TYPES.has(activityType) ||
      activityType.toLowerCase().includes("run") ||
      activityType.toLowerCase().includes("jog");

    if (isRun) {
      result.runningSessions.push({
        id: crypto.randomUUID(),
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

    if (WORKOUT_TYPES.has(activityType) || activityType !== "") {
      result.workoutSessions.push({
        id: crypto.randomUUID(),
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

function parseStravaDate(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return null;
}
