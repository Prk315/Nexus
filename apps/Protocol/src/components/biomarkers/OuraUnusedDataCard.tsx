import { Database } from "lucide-react";
import { CARD_STYLE } from "../../lib/uiHelpers";

/**
 * Everything the Oura API v2 can return that oura-sync does NOT currently pull
 * into Protocol — grouped by endpoint. Cross-referenced against
 * supabase/functions/oura-sync/index.ts field-by-field. Endpoints marked
 * "never called" aren't queried by the sync worker at all; the rest are called,
 * but only some of their fields are read.
 *
 * Not meant to be pretty — a reference list so it's obvious what's left on the
 * table if we want to pull more from Oura later.
 */
const UNUSED: { endpoint: string; note?: string; fields: string[] }[] = [
  {
    endpoint: "daily_sleep",
    fields: [
      "id", "timestamp",
      "contributors.deep_sleep", "contributors.efficiency", "contributors.latency",
      "contributors.rem_sleep", "contributors.restfulness", "contributors.timing",
      "contributors.total_sleep",
    ],
  },
  {
    endpoint: "sleep (detailed periods)",
    fields: [
      "id", "period", "efficiency", "restless_periods", "average_heart_rate",
      "heart_rate (5-min series)", "hrv (5-min series)", "movement_30_sec",
      "sleep_phase_5_min", "low_battery_alert", "readiness (nested)",
      "readiness_score_delta", "sleep_score_delta", "sleep_algorithm_version",
    ],
  },
  {
    endpoint: "daily_readiness",
    fields: [
      "id", "timestamp", "temperature_trend_deviation",
      "contributors.activity_balance", "contributors.body_temperature",
      "contributors.hrv_balance", "contributors.previous_day_activity",
      "contributors.previous_night", "contributors.resting_heart_rate",
      "contributors.sleep_balance",
    ],
  },
  {
    endpoint: "daily_activity",
    fields: [
      "id", "class_5_min", "equivalent_walking_distance", "sedentary_time",
      "resting_time", "non_wear_time", "inactivity_alerts",
      "high_activity_met_minutes", "medium_activity_met_minutes",
      "low_activity_met_minutes", "sedentary_met_minutes", "met (intraday series)",
      "meters_to_target", "target_meters", "timestamp",
      "contributors.meet_daily_targets", "contributors.move_every_hour",
      "contributors.recovery_time", "contributors.stay_active",
      "contributors.training_frequency", "contributors.training_volume",
    ],
  },
  { endpoint: "daily_spo2", fields: ["id", "breathing_disturbance_index"] },
  { endpoint: "daily_stress", fields: ["id"] },
  { endpoint: "daily_resilience", fields: ["id"] },
  { endpoint: "daily_cardiovascular_age", fields: ["id"] },
  { endpoint: "vO2_max", note: "endpoint never called", fields: ["id", "day", "timestamp", "vo2_max"] },
  { endpoint: "heartrate", fields: ["source"] },
  { endpoint: "workout", fields: ["id", "distance", "intensity", "source"] },
  {
    endpoint: "session",
    note: "endpoint never called",
    fields: ["id", "day", "start_datetime", "end_datetime", "type", "mood", "motion_count", "heart_rate", "heart_rate_variability"],
  },
  {
    endpoint: "tag",
    note: "legacy endpoint, never called",
    fields: ["id", "day", "text", "timestamp", "tags"],
  },
  {
    endpoint: "enhanced_tag",
    note: "endpoint never called",
    fields: ["id", "tag_type_code", "start_time", "end_time", "start_day", "end_day", "comment", "custom_name"],
  },
  {
    endpoint: "sleep_time",
    note: "endpoint never called — ideal bedtime recommendation",
    fields: ["id", "day", "optimal_bedtime", "recommendation", "status"],
  },
  {
    endpoint: "rest_mode_period",
    note: "endpoint never called",
    fields: ["id", "start_day", "end_day", "start_time", "end_time", "episodes"],
  },
  {
    endpoint: "ring_configuration",
    note: "endpoint never called",
    fields: ["id", "color", "design", "firmware_version", "hardware_type", "set_id", "size"],
  },
  {
    endpoint: "personal_info",
    note: "endpoint never called — age/weight/height/sex/email",
    fields: ["id", "age", "weight", "height", "biological_sex", "email"],
  },
];

const fieldCount = UNUSED.reduce((sum, g) => sum + g.fields.length, 0);

export default function OuraUnusedDataCard() {
  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Database size={15} color="var(--text-muted)" />
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Oura API — not yet pulled</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
        {fieldCount} data points across {UNUSED.length} endpoints the Oura API v2 exposes that oura-sync doesn't
        currently read. Reference only — nothing here is wired up.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: 420, overflowY: "auto" }}>
        {UNUSED.map((group) => (
          <div key={group.endpoint}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: "monospace", marginBottom: 4 }}>
              {group.endpoint}
              {group.note && (
                <span style={{ fontWeight: 400, color: "var(--text-muted)", fontFamily: "inherit" }}> — {group.note}</span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {group.fields.map((f) => (
                <span
                  key={f}
                  style={{
                    fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)", padding: "2px 7px",
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
