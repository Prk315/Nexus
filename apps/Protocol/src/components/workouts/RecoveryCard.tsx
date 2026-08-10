import { useEffect } from "react";
import { Activity } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchBodyMetrics } from "../../store/slices/biomarkersSlice";
import { useExerciseSets } from "../../lib/useExerciseSets";
import { CARD_STYLE, formatMinutes, isoDate } from "../../lib/uiHelpers";
import RingGauge from "../mealplanner/RingGauge";
import { StatTile } from "../shared/StatTile";
import MuscleMap from "./MuscleMap";
import type { BodyMetric } from "../../store/types";

/** Recovery header for the Workouts dashboard: the muscle-recovery figure beside
 *  the full readiness/vitals read. Reuses the same protocol_body_metrics fields as
 *  the Dashboard's Recovery card but surfaces the extra biomarkers (recovery index,
 *  min/max HR, stress recovery, resilience breakdown, pulse-wave velocity) too. */
export default function RecoveryCard() {
  const dispatch = useAppDispatch();
  const bodyMetrics = useAppSelector((s) => s.biomarkers.bodyMetrics);
  const { exerciseSets } = useExerciseSets();

  useEffect(() => {
    dispatch(fetchBodyMetrics());
  }, [dispatch]);

  const today = isoDate(new Date());
  // Each vital is filled from the most recent day it actually has a value, rather
  // than the single latest row — today's row is often activity-only (no readiness/
  // HRV yet), which left the whole panel blank.
  const sorted = [...bodyMetrics].sort((a, b) => b.date.localeCompare(a.date));
  const pick = (field: keyof BodyMetric): number | string | null => {
    for (const m of sorted) { const val = m[field]; if (val != null) return val as number | string; }
    return null;
  };
  const v = bodyMetrics.length > 0 ? {
    readiness_score: pick("readiness_score") as number | null,
    spo2_pct: pick("spo2_pct") as number | null,
    recovery_index: pick("recovery_index") as number | null,
    hrv_ms: pick("hrv_ms") as number | null,
    resting_hr_bpm: pick("resting_hr_bpm") as number | null,
    avg_heart_rate_bpm: pick("avg_heart_rate_bpm") as number | null,
    min_heart_rate_bpm: pick("min_heart_rate_bpm") as number | null,
    max_heart_rate_bpm: pick("max_heart_rate_bpm") as number | null,
    stress_high_min: pick("stress_high_min") as number | null,
    stress_summary: pick("stress_summary") as string | null,
    stress_recovery_min: pick("stress_recovery_min") as number | null,
    resilience_level: pick("resilience_level") as string | null,
    resilience_sleep_recovery: pick("resilience_sleep_recovery") as number | null,
    resilience_daytime_recovery: pick("resilience_daytime_recovery") as number | null,
    resilience_stress: pick("resilience_stress") as number | null,
    cardio_age: pick("cardio_age") as number | null,
    pulse_wave_velocity: pick("pulse_wave_velocity") as number | null,
    temperature_deviation: pick("temperature_deviation") as number | null,
  } : null;
  const latestVitalDate = sorted.find((m) => m.readiness_score != null || m.hrv_ms != null || m.resting_hr_bpm != null)?.date ?? null;
  const dateLabel = latestVitalDate
    ? latestVitalDate === today
      ? "today"
      : new Date(`${latestVitalDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : bodyMetrics.length > 0 ? "latest" : "no data";

  const num = (n: number | null | undefined, suffix = "") => (n != null ? `${n}${suffix}` : "—");

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Activity size={15} color="var(--series-workout)" />
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Recovery</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {dateLabel}</span>
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <MuscleMap sets={exerciseSets} minimal />

        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 16 }}>
          {!v ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
              No readiness data yet — import from Oura in Biomarkers.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
                {v.readiness_score != null ? (
                  <RingGauge label="Readiness" value={v.readiness_score} goal={100} unit="" color="var(--series-workout)" track="var(--series-workout-track)" />
                ) : (
                  <StatTile label="Readiness" value="—" sub="/ 100" />
                )}
                {v.spo2_pct != null ? (
                  <RingGauge label="SpO2" value={v.spo2_pct} goal={100} unit="%" color="var(--series-sleep)" track="var(--series-sleep-track)" />
                ) : (
                  <StatTile label="SpO2" value="—" sub="%" />
                )}
                {v.recovery_index != null && (
                  <RingGauge label="Recovery" value={v.recovery_index} goal={100} unit="" color="var(--series-body)" track="var(--series-body-track)" />
                )}
                <StatTile label="HRV" value={num(v.hrv_ms)} sub="ms" />
                <StatTile label="Resting HR" value={num(v.resting_hr_bpm)} sub="bpm" />
              </div>

              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
                <StatTile label="Avg heart rate" value={num(v.avg_heart_rate_bpm)} sub="bpm" />
                <StatTile label="Min HR" value={num(v.min_heart_rate_bpm)} sub="bpm" />
                <StatTile label="Max HR" value={num(v.max_heart_rate_bpm)} sub="bpm" />
                <StatTile label="Stress high" value={v.stress_high_min != null ? formatMinutes(v.stress_high_min) : "—"} sub={v.stress_summary ?? undefined} />
                <StatTile label="Stress recovery" value={v.stress_recovery_min != null ? formatMinutes(v.stress_recovery_min) : "—"} />
              </div>

              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
                <StatTile label="Resilience" value={v.resilience_level ?? "—"} />
                <StatTile label="↳ sleep recovery" value={num(v.resilience_sleep_recovery)} />
                <StatTile label="↳ daytime recovery" value={num(v.resilience_daytime_recovery)} />
                <StatTile label="↳ stress" value={num(v.resilience_stress)} />
                <StatTile label="Cardio age" value={num(v.cardio_age)} />
                <StatTile label="Pulse-wave velocity" value={v.pulse_wave_velocity != null ? v.pulse_wave_velocity.toFixed(1) : "—"} sub="m/s" />
                <StatTile
                  label="Temp deviation"
                  value={v.temperature_deviation != null ? `${v.temperature_deviation > 0 ? "+" : ""}${v.temperature_deviation.toFixed(2)}°` : "—"}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Per-muscle fatigue / readiness breakdown */}
      {exerciseSets.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
          <MuscleMap sets={exerciseSets} breakdownOnly />
        </div>
      )}
    </div>
  );
}
